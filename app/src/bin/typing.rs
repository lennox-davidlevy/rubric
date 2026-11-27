//! Task 5's headless numbers: one typed character in the long post with spans on (CPU of the
//! input and the frame that commits it, as Rune's `long_note` measures), and `markdown::spans`
//! over the whole post.
//!
//! cargo run --release --features bench --bin typing -- [post.md] [--samples 60]

use std::path::PathBuf;
use std::time::Instant;

use rune::{Env, Ime, Runtime};
use rubric_app::state::State;

fn stats(mut v: Vec<f64>) -> (f64, f64, f64) {
    v.sort_by(f64::total_cmp);
    let p95 = v[((v.len() - 1) as f64 * 0.95).round() as usize];
    (v[v.len() / 2], p95, v[v.len() - 1])
}

fn runtime(text: &str, caret: usize) -> Runtime<State> {
    let mut s = State::open(PathBuf::from("/nonexistent/long.md"), text.to_string());
    s.edit.set_caret(caret);
    s.width = 1400.0;
    let mut rt = Runtime::with_text(s, rubric_app::view, (1400.0, 900.0), Env::new(false, 1.0), rubric_app::fonts::text_system());
    rt.frame(0.0);
    let mut n = 0;
    while n < 240 && rt.frame(1.0 / 120.0) {
        n += 1;
    }
    rt
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let samples: usize = args.iter().position(|a| a == "--samples").and_then(|i| args.get(i + 1)).map_or(60, |s| s.parse().unwrap());
    let post = args.iter().find(|a| !a.starts_with("--") && a.ends_with(".md")).cloned()
        .unwrap_or_else(|| concat!(env!("CARGO_MANIFEST_DIR"), "/../sites/app-slice/pages/posts/long.md").into());
    let text = std::fs::read_to_string(&post).unwrap();
    if cfg!(debug_assertions) {
        eprintln!("typing: a debug build; measure a --release one");
    }
    println!("POST bytes={} words={} lines={}", text.len(), text.split_whitespace().count(), text.lines().count());

    let theme = rubric_app::state::marks(&rubric_app::theme::Look::load(None, None, None).palette);
    let mut runs = Vec::new();
    for _ in 0..100 {
        let t = Instant::now();
        let spans = rubric_app::markdown::spans(&text, &theme, &[]);
        runs.push(t.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(spans);
    }
    let (median, p95, max) = stats(runs);
    println!("METRIC case=spans metric=wall_ms median={median:.4} p95={p95:.4} max={max:.4} n=100");

    let mid = text[..text.len() / 2].rfind(' ').unwrap_or(0) + 1;
    let start = text.find("Three tellings").unwrap_or(0);
    for (case, at) in [("type_start", start), ("type_mid", mid), ("type_end", text.len())] {
        let mut rt = runtime(&text, at);
        for _ in 0..3 {
            rt.ime(Ime::Commit("w".into()));
            rt.frame(1.0 / 120.0);
        }
        let mut cpu = Vec::new();
        let mut wall = Vec::new();
        for i in 0..samples {
            let ch = ["a", "b", "c", " "][i % 4];
            let (c0, t0) = (rune::thread_cpu_ms(), Instant::now());
            rt.ime(Ime::Commit(ch.into()));
            rt.frame(1.0 / 120.0);
            cpu.push(rune::thread_cpu_ms() - c0);
            wall.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
        assert_eq!(rt.state.version as usize, 1 + 3 + samples, "{case}: every key was one change");
        let (m, p, x) = stats(cpu);
        println!("METRIC case={case} metric=cpu_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");
        let (m, p, x) = stats(wall);
        println!("METRIC case={case} metric=wall_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");
    }

    // Slice 2. Typing on a `new:` line, where the status line is drawn too.
    let new = format!("{text}\n::: new: a tide clock");
    let mut rt = runtime(&new, new.len());
    let mut cpu = Vec::new();
    for i in 0..samples {
        let ch = ["a", "b", "c", " "][i % 4];
        let c0 = rune::thread_cpu_ms();
        rt.ime(Ime::Commit(ch.into()));
        rt.frame(1.0 / 120.0);
        cpu.push(rune::thread_cpu_ms() - c0);
    }
    assert!(rubric_app::draft::line(&rt.state).is_some(), "the status line shows");
    let (m, p, x) = stats(cpu);
    println!("METRIC case=type_new_line metric=cpu_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");

    // The server's view arriving and the frame that draws the menu; then a key in the open
    // menu and its frame.
    use rubric_app::lsp::Incoming;
    use rune::{Key, KeyEvent, Mods};
    let (mut open, mut moved) = (Vec::new(), Vec::new());
    for i in 0..samples {
        let mut rt = runtime(&new, new.len());
        let (client, sent) = rubric_app::lsp::Client::recording();
        rt.update(|s, _| rubric_app::state::connected(s, client));
        rt.frame(1.0 / 120.0);
        while sent.try_recv().is_ok() {}
        rt.key(KeyEvent { key: Key::Tab, mods: Mods::default() });
        rt.frame(1.0 / 120.0);
        let id = std::iter::from_fn(|| sent.try_recv().ok()).find(|m| m["method"] == "rubric/draft").expect("Tab asks")["id"].as_i64().unwrap();
        let view = serde_json::json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock" });
        let c0 = rune::thread_cpu_ms();
        rt.update(|s, _| {
            rubric_app::state::incoming(s, Incoming::Response { id, result: Ok(view) });
        });
        rt.frame(1.0 / 120.0);
        open.push(rune::thread_cpu_ms() - c0);
        assert!(rt.find("panel-0").is_some(), "the menu is drawn");
        // The entrance settles before the key is timed.
        let mut n = 0;
        while n < 240 && rt.frame(1.0 / 120.0) {
            n += 1;
        }
        let c0 = rune::thread_cpu_ms();
        rt.key(KeyEvent { key: if i % 2 == 0 { Key::Down } else { Key::Up }, mods: Mods::default() });
        rt.frame(1.0 / 120.0);
        moved.push(rune::thread_cpu_ms() - c0);
    }
    let (m, p, x) = stats(open);
    println!("METRIC case=menu_open metric=cpu_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");
    let (m, p, x) = stats(moved);
    println!("METRIC case=menu_key metric=cpu_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");

    // Slice 3. A placed part's menu: both answers in and the frame that draws it; then a
    // segment's key, the server's line put in place, and its frame.
    let quote = format!("{text}\n::: quote\nWords.\n:::\n");
    let at = quote.find("::: quote").unwrap() + "::: quote".len();
    let part = serde_json::json!({ "name": "quote", "kind": "catalog", "uses": { "blocks": 1, "pages": 1 }, "close": 3,
        "settings": [{ "name": "size", "type": "choice", "values": ["normal", "large"], "default": "normal" }, { "name": "cite", "type": "text" }],
        "look": [{ "name": "shadow", "type": "choice", "values": ["none", "soft", "deep"], "default": "none" }] });
    let (mut open, mut set) = (Vec::new(), Vec::new());
    for _ in 0..samples {
        let mut rt = runtime(&quote, at);
        let (client, sent) = rubric_app::lsp::Client::recording();
        rt.update(|s, _| rubric_app::state::connected(s, client));
        rt.frame(1.0 / 120.0);
        while sent.try_recv().is_ok() {}
        rt.key(KeyEvent { key: Key::Tab, mods: Mods::default() });
        rt.frame(1.0 / 120.0);
        let reqs: Vec<serde_json::Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
        let asked = reqs.iter().find(|m| m["method"] == "rubric/part").expect("Tab asks part")["id"].as_i64().unwrap();
        let look = reqs.iter().find(|m| m["method"] == "rubric/draft").expect("Tab asks draft")["id"].as_i64().unwrap();
        let c0 = rune::thread_cpu_ms();
        let answer = part.clone();
        rt.update(|s, _| {
            rubric_app::state::incoming(s, Incoming::Response { id: asked, result: Ok(answer) });
            rubric_app::state::incoming(s, Incoming::Response { id: look, result: Ok(serde_json::json!({ "words": "A quote", "of": "quote", "catalog": true })) });
        });
        rt.frame(1.0 / 120.0);
        open.push(rune::thread_cpu_ms() - c0);
        assert!(rt.find("panel-0").is_some(), "the part's menu is drawn");
        let mut n = 0;
        while n < 240 && rt.frame(1.0 / 120.0) {
            n += 1;
        }
        let c0 = rune::thread_cpu_ms();
        rt.key(KeyEvent { key: Key::Right, mods: Mods::default() });
        rt.frame(1.0 / 120.0);
        let asked = std::iter::from_fn(|| sent.try_recv().ok()).find(|m| m["method"] == "rubric/part").expect("Right")["id"].as_i64().unwrap();
        let line = "::: quote size=large";
        rt.update(|s, _| {
            rubric_app::state::incoming(s, Incoming::Response { id: asked, result: Ok(serde_json::json!({ "replace": line })) });
        });
        rt.frame(1.0 / 120.0);
        set.push(rune::thread_cpu_ms() - c0);
        assert!(rt.state.edit.text.contains(line), "the line changed");
    }
    let (m, p, x) = stats(open);
    println!("METRIC case=part_menu_open metric=cpu_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");
    let (m, p, x) = stats(set);
    println!("METRIC case=part_segment_to_line metric=cpu_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");

    if args.iter().any(|a| a == "--server") {
        server(&text, samples);
    }
}

/// Against the real server with the stub resolver, on a copy of `sites/app-slice` in a temporary
/// folder: Tab on a part's line to both answers (`rubric/part`, then `rubric/draft`), and a
/// setting's change to its answer. The app's own part is the numbers above.
fn server(text: &str, samples: usize) {
    use rubric_app::lsp::{Client, Incoming};
    use serde_json::json;
    use std::sync::mpsc;
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    let site = std::env::temp_dir().join(format!("rubric-measure-{}", std::process::id()));
    std::fs::create_dir_all(site.join("pages/posts")).unwrap();
    for f in ["rubric.md", "hugo.toml"] {
        std::fs::copy(repo.join("sites/app-slice").join(f), site.join(f)).unwrap();
    }
    let post = site.join("pages/posts/long.md");
    let body = format!("{text}\n::: quote\nWords.\n:::\n");
    std::fs::write(&post, &body).unwrap();
    let uri = rubric_app::state::file_uri(&post);
    let (tx, rx) = mpsc::channel::<Incoming>();
    let client = Client::start(&repo, &site, true, move |m| {
        let _ = tx.send(m);
    })
    .expect("the server starts");
    client.notify("textDocument/didOpen", json!({ "textDocument": { "uri": uri, "languageId": "markdown", "version": 1, "text": body } }));
    let line = body.lines().position(|l| l == "::: quote").unwrap() as u32;
    let call = |method: &str, p: serde_json::Value| {
        let id = client.request(method, p);
        loop {
            match rx.recv_timeout(std::time::Duration::from_secs(20)).expect("an answer") {
                Incoming::Response { id: got, result } if got == id => return result.unwrap(),
                _ => {}
            }
        }
    };
    let (mut tab, mut set) = (Vec::new(), Vec::new());
    for i in 0..samples {
        let t = Instant::now();
        let p_id = client.request("rubric/part", json!({ "uri": uri, "line": line }));
        let d_id = client.request("rubric/draft", json!({ "uri": uri, "line": line }));
        let (mut got_p, mut got_d) = (false, false);
        while !(got_p && got_d) {
            if let Incoming::Response { id, result } = rx.recv_timeout(std::time::Duration::from_secs(20)).expect("an answer") {
                if id == p_id {
                    result.unwrap();
                    got_p = true;
                } else if id == d_id {
                    result.unwrap();
                    got_d = true;
                }
            }
        }
        tab.push(t.elapsed().as_secs_f64() * 1000.0);
        let t = Instant::now();
        let value = if i % 2 == 0 { "large" } else { "normal" };
        call("rubric/part", json!({ "uri": uri, "line": line, "set": { "name": "size", "value": value } }));
        set.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let (m, p, x) = stats(tab);
    println!("METRIC case=server_tab_to_answers metric=wall_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");
    let (m, p, x) = stats(set);
    println!("METRIC case=server_set metric=wall_ms median={m:.4} p95={p:.4} max={x:.4} n={samples}");
    client.stop();
    let _ = std::process::Command::new("bun").arg(repo.join("src/cli.ts")).arg("stop").arg(&site).current_dir(&repo).output();
    let _ = std::fs::remove_dir_all(&site);
}
