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

/// The next message `want` picks out, within 20 s.
fn next<T>(rx: &mpsc::Receiver<Incoming>, what: &str, mut want: impl FnMut(&Incoming) -> Option<T>) -> T {
    let end = Instant::now() + Duration::from_secs(20);
    loop {
        let m = rx.recv_timeout(end.saturating_duration_since(Instant::now())).unwrap_or_else(|_| panic!("timed out waiting for {what}"));
        if let Some(t) = want(&m) {
            return t;
        }
    }
}

#[test]
#[ignore = "starts Bun, a site process and Hugo"]
fn a_new_part_is_drafted_rerolled_kept_and_cancelled_with_the_stub() {
    use rubric_app::draft::{self, Asked, View, What};

    let site = std::env::temp_dir().join(format!("rubric-app-draft-{}", std::process::id()));
    std::fs::create_dir_all(&site).unwrap();
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

    let mut edit = rune::TextEdit::new(format!("{text}\n::: new: a tide clock\n:::\n\n::: new: a failing bell\n:::\n\n::: new: a brass bell\n:::\n\n::: new: a quote from the keeper\n:::\n"));
    let mut version = 1;
    client.notify("textDocument/didOpen", json!({ "textDocument": { "uri": uri, "languageId": "markdown", "version": version, "text": edit.text } }));
    let line_of = |text: &str, l: &str| text.lines().position(|x| x == l).unwrap_or_else(|| panic!("no line {l:?}")) as u32;
    let ask = |action: Option<&str>, line: u32, extra: serde_json::Value| {
        let mut p = draft::params(action, &uri, line);
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        let id = client.request("rubric/draft", p);
        next(&rx, "an answer to rubric/draft", |m| match m {
            Incoming::Response { id: got, result } if *got == id => Some(result.clone().expect("no error")),
            _ => None,
        })
    };
    let drafted = |status: &str, words: &str| {
        next(&rx, "rubric/drafted", |m| match m {
            Incoming::Notification { method, params } if method == "rubric/drafted" && params["status"] == status && params["words"] == words => Some(params.clone()),
            _ => None,
        })
    };

    // The server's word for the line, before anything is drafted.
    let clock = line_of(&edit.text, "::: new: a tide clock");
    let view = View::parse(&ask(None, clock, json!({}))).expect("a view");
    assert_eq!(view.words, "a tide clock");
    assert!(ids(&view).contains(&"build".to_string()));

    // Drafted: the page's content draws it.
    ask(Some("build"), clock, json!({}));
    let ready = drafted("ready", "a tide clock");
    let name = ready["name"].as_str().unwrap().to_string();
    let written = site.join("content/posts/long.md");
    wait_for("the draft in content/", || std::fs::read_to_string(&written).is_ok_and(|t| t.contains(&name)));
    let view = View::parse(&ask(None, clock, json!({}))).unwrap();
    assert_eq!((view.status.as_deref(), view.name.as_deref()), (Some("ready"), Some(name.as_str())));

    // Rerolled with notes: another take, named as the notes say.
    ask(Some("reroll"), clock, json!({ "change": "name it tide-two" }));
    assert_eq!(drafted("ready", "a tide clock")["name"], "tide-two");

    // Two takes: the first back on screen, then the second again.
    let view = View::parse(&ask(None, clock, json!({}))).unwrap();
    assert_eq!((view.take, view.takes, view.list.len()), (Some(2), 2, 2));
    assert!(ids(&view).contains(&"takes".to_string()));
    let first = View::parse(&ask(Some("take"), clock, json!({ "to": 1 }))).unwrap();
    assert_eq!((first.take, first.name.as_deref()), (Some(1), Some(name.as_str())));
    assert_eq!(View::parse(&ask(Some("take"), clock, json!({ "to": 2 }))).unwrap().take, Some(2));

    // Kept for the site: the line is the part's, and the site has the part.
    let asked = Asked { line: clock, text: "::: new: a tide clock".into(), what: What::Act };
    let kept = ask(Some("keep"), clock, json!({ "global": false }));
    assert!(draft::replace(&mut edit, &asked, &kept), "{kept}");
    assert!(edit.text.lines().nth(clock as usize).unwrap().contains("tide-two"), "{}", edit.text);
    assert!(!edit.text.contains("new: a tide clock"));
    assert_eq!(kept["part"]["name"], "tide-two");
    assert!(site.join("parts/tide-two/part.yaml").is_file());
    version += 1;
    client.notify("textDocument/didChange", json!({ "textDocument": { "uri": uri, "version": version }, "contentChanges": [{ "text": edit.text }] }));

    // A draft that fails: the line's menu offers another try.
    let bell = line_of(&edit.text, "::: new: a failing bell");
    ask(Some("build"), bell, json!({}));
    drafted("failed", "a failing bell");
    let view = View::parse(&ask(None, bell, json!({}))).unwrap();
    assert_eq!(view.status.as_deref(), Some("failed"));
    assert_eq!(ids(&view)[0], "reroll");

    // A draft cancelled: the line keeps its words, without `new:`.
    let brass = line_of(&edit.text, "::: new: a brass bell");
    ask(Some("build"), brass, json!({}));
    drafted("ready", "a brass bell");
    let asked = Asked { line: brass, text: "::: new: a brass bell".into(), what: What::Act };
    assert!(draft::replace(&mut edit, &asked, &ask(Some("cancel"), brass, json!({}))));
    assert_eq!(edit.text.lines().nth(brass as usize), Some("::: a brass bell"));

    // Words near a part the site has: the menu lists it, and using it puts it on the line.
    let keeper = line_of(&edit.text, "::: new: a quote from the keeper");
    let view = View::parse(&ask(None, keeper, json!({}))).unwrap();
    assert!(view.near.iter().any(|n| n.name == "quote"), "{:?}", view.near);
    assert!(ids(&view).contains(&"near".to_string()));
    client.notify("rubric/peek", json!({ "uri": uri, "line": keeper, "part": "quote" }));
    let asked = Asked { line: keeper, text: "::: new: a quote from the keeper".into(), what: What::Act };
    assert!(draft::replace(&mut edit, &asked, &ask(Some("use"), keeper, json!({ "part": "quote" }))));
    assert_eq!(edit.text.lines().nth(keeper as usize), Some("::: quote"));

    // The tracked site gained nothing.
    assert!(!repo().join("sites/app-slice/parts").exists());

    client.stop();
    wait_for("the server's process to end", || !alive(pid));
}

#[test]
#[ignore = "starts Bun, a site process and Hugo"]
fn a_part_is_inserted_changed_into_a_variant_kept_rerolled_and_removed_with_the_stub() {
    use rubric_app::draft::{self, Asked, View, What};
    use rubric_app::part::{self, Part};

    let site = std::env::temp_dir().join(format!("rubric-app-part-{}", std::process::id()));
    std::fs::create_dir_all(&site).unwrap();
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

    let mut edit = rune::TextEdit::new(format!("{text}\n\n::: new: a tide clock\n:::\n"));
    let mut version = 1;
    client.notify("textDocument/didOpen", json!({ "textDocument": { "uri": uri, "languageId": "markdown", "version": version, "text": edit.text } }));
    let mut sync = |edit: &rune::TextEdit| {
        version += 1;
        client.notify("textDocument/didChange", json!({ "textDocument": { "uri": uri, "version": version }, "contentChanges": [{ "text": edit.text }] }));
    };
    let line_of = |text: &str, l: &str| text.lines().position(|x| x == l).unwrap_or_else(|| panic!("no line {l:?} in {text}")) as u32;
    let call = |method: &str, p: serde_json::Value| {
        let id = client.request(method, p);
        next(&rx, method, |m| match m {
            Incoming::Response { id: got, result } if *got == id => Some(result.clone().expect("no error")),
            _ => None,
        })
    };
    let ask = |action: Option<&str>, line: u32, extra: serde_json::Value| {
        let mut p = draft::params(action, &uri, line);
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        call("rubric/draft", p)
    };
    let ready = |name: &dyn Fn(&str) -> bool| {
        next(&rx, "rubric/drafted", |m| match m {
            Incoming::Notification { method, params } if method == "rubric/drafted" && params["status"] == "ready" && params["name"].as_str().is_some_and(name) => Some(params.clone()),
            _ => None,
        })
    };
    let written = site.join("content/posts/long.md");

    // Inserted on the empty line: the page draws a quote there.
    let empty = line_of(&edit.text, "");
    let entry = rubric_app::insert::Entry { name: "quote".into(), ..Default::default() };
    rubric_app::insert::place(&mut edit, empty, &entry);
    let body = rubric_app::position::line_range(&edit.text, empty + 1).start;
    edit.set_caret(body);
    edit.insert("Water before food.\n");
    sync(&edit);
    wait_for("the quote in content/", || std::fs::read_to_string(&written).is_ok_and(|t| t.contains("{{< quote")));
    let quote = line_of(&edit.text, "::: quote");
    let p = Part::parse(&call("rubric/part", json!({ "uri": uri, "line": quote }))).expect("a part");
    assert_eq!((p.name.as_str(), p.kind.as_str(), p.close), ("quote", "catalog", Some(quote + 2)));

    // Change…: the words after the colon, and a variant drafted from them.
    let lead = edit.text.lines().nth(quote as usize).unwrap().to_string();
    part::set_line(&mut edit, quote, &format!("{} : torn edge", part::lead(&lead)));
    sync(&edit);
    let view = View::parse(&ask(None, quote, json!({}))).expect("a view");
    assert_eq!(view.of.as_deref(), Some("quote"));
    ask(Some("build"), quote, json!({ "variant": true }));
    let name = ready(&|n| n.starts_with("quote--"))["name"].as_str().unwrap().to_string();
    let view = View::parse(&ask(None, quote, json!({}))).unwrap();
    assert_eq!((view.status.as_deref(), view.new_variant.as_deref()), (Some("ready"), Some("quote")));

    // Kept: the line asks for the variant, and the server reads it so.
    let asked = Asked { line: quote, text: edit.text.lines().nth(quote as usize).unwrap().to_string(), what: What::Act };
    assert!(draft::replace(&mut edit, &asked, &ask(Some("keep"), quote, json!({ "global": false }))));
    let kept = edit.text.lines().nth(quote as usize).unwrap().to_string();
    assert_eq!(kept, format!("::: quote variant={}", &name["quote--".len()..]));
    assert!(site.join("parts").join(&name).join("part.yaml").is_file());
    sync(&edit);
    let p = Part::parse(&call("rubric/part", json!({ "uri": uri, "line": quote }))).unwrap();
    assert_eq!(p.kind, "variant");

    // Back to quote.
    let asked = Asked { line: quote, text: kept, what: What::Act };
    assert!(draft::replace(&mut edit, &asked, &ask(Some("plain"), quote, json!({}))));
    assert_eq!(edit.text.lines().nth(quote as usize), Some("::: quote"));
    sync(&edit);

    // A new part kept for the site, rerolled on its own line, then removed from the site.
    let clock = line_of(&edit.text, "::: new: a tide clock");
    ask(Some("build"), clock, json!({}));
    let clock_name = ready(&|n| !n.starts_with("quote"))["name"].as_str().unwrap().to_string();
    let asked = Asked { line: clock, text: "::: new: a tide clock".into(), what: What::Act };
    assert!(draft::replace(&mut edit, &asked, &ask(Some("keep"), clock, json!({ "global": false }))));
    sync(&edit);
    let own = site.join("parts").join(&clock_name);
    assert!(own.join("part.yaml").is_file());
    let p = Part::parse(&call("rubric/part", json!({ "uri": uri, "line": clock }))).unwrap();
    assert_eq!(p.kind, "own");
    ask(Some("reroll"), clock, json!({ "change": "" }));
    ready(&|n| n == clock_name);
    let view = View::parse(&ask(None, clock, json!({}))).unwrap();
    assert_eq!((view.status.as_deref(), view.takes), (Some("ready"), 2));
    ask(Some("keep"), clock, json!({ "global": false }));
    let removed = ask(Some("remove"), clock, json!({}));
    assert!(removed.get("removed").is_some(), "{removed}");
    assert!(!own.exists(), "the site's parts/ lost it");

    client.stop();
    wait_for("the server's process to end", || !alive(pid));
}

/// The ids of the rows of a line's menu.
fn ids(view: &rubric_app::draft::View) -> Vec<String> {
    rubric_app::draft::menu_rows(view, None, None).0.iter().filter(|r| r.takes_focus()).filter_map(|r| r.id().map(str::to_string)).collect()
}

struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = Command::new("bun").arg(repo().join("src/cli.ts")).arg("stop").arg(&self.0).current_dir(repo()).output();
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
