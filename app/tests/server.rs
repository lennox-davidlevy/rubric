//! Against the real server with the stub resolver: `cargo test -- --ignored` (starts Bun, a site
//! process and Hugo for a temporary copy of `sites/app-slice`, and stops them).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use rubric_app::lsp::{Client, Incoming};
use serde_json::json;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

/// The site's own files (rubric.md, hugo.toml, pages/), nothing it generated.
fn copy_site(to: &Path) {
    let from = repo().join("sites/app-slice");
    for f in ["rubric.md", "hugo.toml"] {
        std::fs::copy(from.join(f), to.join(f)).unwrap();
    }
    std::fs::create_dir_all(to.join("pages/posts")).unwrap();
    std::fs::copy(from.join("pages/posts/long.md"), to.join("pages/posts/long.md")).unwrap();
}

/// `kill -0`, which works on Linux and macOS. The child is reaped by `Client::stop`.
fn alive(pid: u32) -> bool {
    Command::new("kill").arg("-0").arg(pid.to_string()).output().is_ok_and(|o| o.status.success())
}

fn wait_for(what: &str, mut ok: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(20);
    while !ok() {
        assert!(Instant::now() < end, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
#[ignore = "starts Bun, a site process and Hugo"]
fn the_stub_server_writes_the_page_and_offers_a_pick_with_a_pin() {
    let site = std::env::temp_dir().join(format!("rubric-app-server-{}", std::process::id()));
    std::fs::create_dir_all(&site).unwrap();
    // Stops the copy's process and removes it, also when an assertion fails.
    let _cleanup = Cleanup(site.clone());
    copy_site(&site);
    let post = site.join("pages/posts/long.md");
    let uri = rubric_app::state::file_uri(&post);
    let text = std::fs::read_to_string(&post).unwrap();

    let (tx, rx) = mpsc::channel::<Incoming>();
    let client = Client::start(&repo(), &site, true, move |m| {
        let _ = tx.send(m);
    })
    .expect("the server starts");
    let pid = client.pid().unwrap();

    // Typed: a sentence at the end, then a words line with its closer.
    let typed = format!("{text}\nA sentence typed in the app.\n\n::: a quote\n:::\n");
    client.notify("textDocument/didOpen", json!({ "textDocument": { "uri": uri, "languageId": "markdown", "version": 1, "text": text } }));
    client.notify("textDocument/didChange", json!({ "textDocument": { "uri": uri, "version": 2 }, "contentChanges": [{ "text": typed }] }));
    let written = site.join("content/posts/long.md");
    wait_for("content/posts/long.md with the sentence", || {
        std::fs::read_to_string(&written).is_ok_and(|t| t.contains("A sentence typed in the app."))
    });

    // The words line asks for a pick: the stub places a quote, with a pin that acts.
    let line = typed.lines().position(|l| l == "::: a quote").unwrap() as u32;
    let id = client.request("textDocument/inlineCompletion", json!({
        "textDocument": { "uri": uri },
        "position": { "line": line, "character": 11 },
        "context": { "triggerKind": 2 },
    }));
    let end = Instant::now() + Duration::from_secs(20);
    let result = loop {
        match rx.recv_timeout(end.saturating_duration_since(Instant::now())).expect("an answer to inlineCompletion") {
            Incoming::Response { id: got, result } if got == id => break result.unwrap(),
            _ => {}
        }
    };
    let ghost = rubric_app::ghost::parse(&result, line, 2).expect("a pick");
    let pin = ghost.pick.pin.expect("the pick has a pin");
    assert!(pin.acts);
    assert_eq!(pin.line, line);
    assert!(pin.text.starts_with(":::") && pin.text.contains("quote"), "{}", pin.text);

    client.stop();
    wait_for("the server's process to end", || !alive(pid));
}

struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = Command::new("bun").arg(repo().join("src/cli.ts")).arg("stop").arg(&self.0).current_dir(repo()).output();
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
