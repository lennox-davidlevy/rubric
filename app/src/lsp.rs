//! The language client: Rubric's own server (`bun src/cli.ts lsp`) over stdio, with standard
//! LSP framing.

use std::io::{self, BufWriter, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// One message, framed with its `Content-Length` header.
pub fn encode(msg: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(msg).expect("a JSON value serializes");
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend_from_slice(&body);
    out
}

/// Takes bytes as they come and gives back each whole message.
#[derive(Default)]
pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Value> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let Some(end) = self.buf.windows(4).position(|w| w == b"\r\n\r\n") else { break };
            let header = String::from_utf8_lossy(&self.buf[..end]);
            let length = header.lines().find_map(|l| {
                let (k, v) = l.split_once(':')?;
                k.trim().eq_ignore_ascii_case("content-length").then(|| v.trim().parse::<usize>().ok()).flatten()
            });
            let Some(length) = length else {
                // A header with no length: drop it and look for the next.
                self.buf.drain(..end + 4);
                continue;
            };
            if self.buf.len() < end + 4 + length {
                break;
            }
            let body: Vec<u8> = self.buf.drain(..end + 4 + length).skip(end + 4).collect();
            if let Ok(v) = serde_json::from_slice(&body) {
                out.push(v);
            }
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    /// `Err` holds the error's message.
    Response { id: i64, result: Result<Value, String> },
    /// Answered with null by the client.
    Request { id: Value, method: String },
    Notification { method: String, params: Value },
}

pub fn classify(msg: Value) -> Option<Incoming> {
    let method = msg.get("method").and_then(Value::as_str).map(str::to_string);
    match (method, msg.get("id")) {
        (Some(method), Some(id)) => Some(Incoming::Request { id: id.clone(), method }),
        (Some(method), None) => Some(Incoming::Notification { method, params: msg.get("params").cloned().unwrap_or(Value::Null) }),
        (None, Some(id)) => {
            let id = id.as_i64()?;
            let result = match msg.get("error") {
                Some(e) => Err(e.get("message").and_then(Value::as_str).unwrap_or("error").to_string()),
                None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
            };
            Some(Incoming::Response { id, result })
        }
        (None, None) => None,
    }
}

pub struct Client {
    out: Sender<Value>,
    next: AtomicI64,
    child: Option<Child>,
}

impl Client {
    /// Spawns `bun <repo>/src/cli.ts lsp [--stub]` with cwd `repo`, sends initialize (rootUri =
    /// site root), blocks until its response arrives, then sends initialized. Call it from a
    /// thread of its own, never the UI thread. `on` is called on a reader thread.
    pub fn start(repo: &Path, site: &Path, stub: bool, on: impl Fn(Incoming) + Send + 'static) -> io::Result<Client> {
        let mut cmd = Command::new("bun");
        cmd.arg(repo.join("src/cli.ts")).arg("lsp");
        if stub {
            cmd.arg("--stub");
        }
        let mut child = cmd.current_dir(repo).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()?;
        let stdin = child.stdin.take().expect("piped");
        let mut stdout = child.stdout.take().expect("piped");
        let (out, rx) = mpsc::channel::<Value>();
        std::thread::Builder::new().name("lsp-write".into()).spawn(move || write_all(stdin, rx))?;

        let (ready_tx, ready_rx) = mpsc::channel::<Result<Value, String>>();
        let answer = out.clone();
        std::thread::Builder::new().name("lsp-read".into()).spawn(move || {
            let mut dec = Decoder::default();
            let mut buf = vec![0u8; 64 * 1024];
            let mut ready = Some(ready_tx);
            loop {
                let n = match stdout.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                for msg in dec.push(&buf[..n]) {
                    let Some(m) = classify(msg) else { continue };
                    match m {
                        Incoming::Response { id: 0, result } if ready.is_some() => {
                            let _ = ready.take().expect("checked").send(result);
                        }
                        Incoming::Request { ref id, .. } => {
                            let _ = answer.send(json!({ "jsonrpc": "2.0", "id": id, "result": null }));
                            on(m);
                        }
                        m => on(m),
                    }
                }
            }
        })?;

        let mut client = Client { out, next: AtomicI64::new(0), child: Some(child) };
        let root = crate::state::file_uri(site);
        let init = client.request("initialize", json!({
            "processId": std::process::id(),
            "clientInfo": { "name": "rubric-app" },
            "rootUri": root,
            "workspaceFolders": [{ "uri": root, "name": "site" }],
            "capabilities": {},
        }));
        debug_assert_eq!(init, 0);
        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                client.kill();
                return Err(io::Error::other(format!("initialize: {e}")));
            }
            Err(_) => {
                client.kill();
                return Err(io::Error::other("the server did not answer initialize"));
            }
        }
        client.notify("initialized", json!({}));
        Ok(client)
    }

    /// A client with no server, whose messages go to the receiver: for tests.
    pub fn recording() -> (Client, Receiver<Value>) {
        let (out, rx) = mpsc::channel();
        (Client { out, next: AtomicI64::new(1), child: None }, rx)
    }

    pub fn notify(&self, method: &str, params: Value) {
        let _ = self.out.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }));
    }

    /// Returns the id.
    pub fn request(&self, method: &str, params: Value) -> i64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let _ = self.out.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        id
    }

    /// shutdown, exit, then kill if still alive after 500 ms.
    pub fn stop(mut self) {
        self.request("shutdown", Value::Null);
        self.notify("exit", Value::Null);
        // A bare null tells the writer to stop, which closes stdin and ends the bridge. (`exit`
        // goes without waiting for the shutdown's answer; this server takes it.)
        let _ = self.out.send(Value::Null);
        if let Some(mut child) = self.child.take() {
            let end = Instant::now() + Duration::from_millis(500);
            while Instant::now() < end {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// The server's process id, while it runs.
    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(Child::id)
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.kill();
    }
}

fn write_all(stdin: ChildStdin, rx: Receiver<Value>) {
    let mut w = BufWriter::new(stdin);
    // A bare null is `stop`'s: the writer ends, and stdin closes with it.
    while let Ok(msg) = rx.recv() {
        if msg.is_null() || w.write_all(&encode(&msg)).is_err() {
            let _ = w.flush();
            return;
        }
        // Everything waiting goes in one write.
        while let Ok(msg) = rx.try_recv() {
            if msg.is_null() || w.write_all(&encode(&msg)).is_err() {
                let _ = w.flush();
                return;
            }
        }
        if w.flush().is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_split_across_three_pushes_comes_out_once_whole() {
        let bytes = encode(&json!({ "id": 1, "result": "ok" }));
        let mut d = Decoder::default();
        assert!(d.push(&bytes[..5]).is_empty());
        assert!(d.push(&bytes[5..30]).is_empty());
        let out = d.push(&bytes[30..]);
        assert_eq!(out, vec![json!({ "id": 1, "result": "ok" })]);
    }

    #[test]
    fn two_messages_in_one_push_come_out_in_order() {
        let mut bytes = encode(&json!({ "method": "a" }));
        bytes.extend(encode(&json!({ "method": "b" })));
        let out = Decoder::default().push(&bytes);
        assert_eq!(out, vec![json!({ "method": "a" }), json!({ "method": "b" })]);
    }

    #[test]
    fn the_length_counts_bytes_of_a_multibyte_body() {
        let msg = json!({ "params": { "text": "café 🙂 ok" } });
        let bytes = encode(&msg);
        let mut d = Decoder::default();
        let mid = bytes.len() - 4;
        assert!(d.push(&bytes[..mid]).is_empty());
        assert_eq!(d.push(&bytes[mid..]), vec![msg]);
    }

    #[test]
    fn messages_are_told_apart() {
        assert_eq!(classify(json!({ "id": 3, "result": [1] })), Some(Incoming::Response { id: 3, result: Ok(json!([1])) }));
        assert_eq!(classify(json!({ "id": 3, "error": { "message": "no" } })), Some(Incoming::Response { id: 3, result: Err("no".into()) }));
        assert!(matches!(classify(json!({ "id": "x", "method": "window/workDoneProgress/create" })), Some(Incoming::Request { .. })));
        assert!(matches!(classify(json!({ "method": "rubric/serving", "params": {} })), Some(Incoming::Notification { .. })));
    }
}
