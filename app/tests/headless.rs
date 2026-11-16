//! The app's view in Rune's headless runtime: no window, no web view, no server.

use std::path::PathBuf;

use rune::{Env, Ime, Key, KeyEvent, Mods, Runtime};
use rubric_app::state::State;

pub fn runtime(text: &str, caret: usize) -> Runtime<State> {
    let mut s = State::open(PathBuf::from("/nonexistent/post.md"), text.to_string());
    s.edit.set_caret(caret);
    s.width = 1000.0;
    let mut rt = Runtime::new(s, rubric_app::view, (1000.0, 700.0), Env::new(false, 1.0));
    rt.frame(0.0);
    rt
}

fn press(rt: &mut Runtime<State>, key: Key) {
    rt.key(KeyEvent { key, mods: Mods::default() });
    rt.frame(1.0 / 60.0);
}

fn editor_focused(rt: &Runtime<State>) -> bool {
    rt.elements().into_iter().any(|e| e.key.as_deref() == Some("editor") && e.focused)
}

#[test]
fn a_typed_character_lands_in_the_text_and_the_version_goes_up() {
    let mut rt = runtime("# Hi\n\nbody", 10);
    assert!(editor_focused(&rt));
    rt.ime(Ime::Commit("x".into()));
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.edit.text, "# Hi\n\nbodyx");
    assert_eq!(rt.state.version, 2);
}

#[test]
fn return_makes_a_new_line_as_one_change() {
    let mut rt = runtime("ab", 1);
    press(&mut rt, Key::Enter);
    assert_eq!(rt.state.edit.text, "a\nb");
    assert_eq!(rt.state.version, 2);
}

#[test]
fn tab_leaves_the_text_and_the_focus_alone() {
    let mut rt = runtime("ab", 1);
    press(&mut rt, Key::Tab);
    assert_eq!(rt.state.edit.text, "ab");
    assert_eq!(rt.state.version, 1);
    assert!(editor_focused(&rt));
}

#[test]
fn a_space_after_an_opener_adds_the_closer_as_one_change() {
    let mut rt = runtime("a\n:::", 5);
    press(&mut rt, Key::Text(" ".into()));
    assert_eq!(rt.state.edit.text, "a\n::: \n:::");
    assert_eq!(rt.state.version, 2);
    assert_eq!(rt.state.edit.range(), (6, 6));
}

#[test]
fn dragging_the_divider_moves_the_split_by_the_distance_over_the_width() {
    let mut rt = runtime("text", 0);
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.width, 1000.0);
    let (x, y) = rt.find("divider").unwrap();
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_move(x + 50.0, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_move(x + 100.0, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x + 100.0, y);
    rt.frame(1.0 / 60.0);
    let room = 1000.0 - rubric_app::DIVIDER;
    assert!((rt.state.split - (0.5 + 100.0 / room)).abs() < 1e-4, "split {}", rt.state.split);
    // And dragged near the right edge, it snaps to writing only.
    let (x, y) = rt.find("divider").unwrap();
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_move(x + 380.0, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x + 380.0, y);
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.split, 1.0);
    // To the left edge (page only) and back: the writing still takes typing.
    let (x, y) = rt.find("divider").unwrap();
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_move(x - 990.0, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x - 990.0, y);
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.split, 0.0);
    let (x, y) = rt.find("divider").unwrap();
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_move(x + 497.0, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x + 497.0, y);
    rt.frame(1.0 / 60.0);
    rt.ime(Ime::Commit("x".into()));
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.edit.text, "xtext");
}

#[test]
fn a_typed_character_sends_the_whole_text_with_the_next_version() {
    let mut rt = runtime("ab\ncd", 5);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut rt.state, client);
    let open = sent.try_recv().unwrap();
    assert_eq!(open["method"], "textDocument/didOpen");
    assert_eq!(open["params"]["textDocument"]["text"], "ab\ncd");
    let cursor = sent.try_recv().unwrap();
    assert_eq!((cursor["method"].as_str(), cursor["params"]["line"].as_u64()), (Some("rubric/cursor"), Some(1)));

    rt.ime(Ime::Commit("x".into()));
    rt.frame(1.0 / 60.0);
    let change = sent.try_recv().unwrap();
    assert_eq!(change["method"], "textDocument/didChange");
    assert_eq!(change["params"]["textDocument"]["version"], 2);
    assert_eq!(change["params"]["contentChanges"][0]["text"], "ab\ncdx");
    assert!(change["params"]["contentChanges"][0].get("range").is_none(), "the whole text, no range");
    assert!(sent.try_recv().is_err(), "the caret stayed on its line: no cursor sent");
}

#[test]
fn the_caret_moving_to_another_line_sends_it_once() {
    let mut rt = runtime("ab\ncd\nef", 0);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut rt.state, client);
    while sent.try_recv().is_ok() {}
    // The headless runtime has no window hooks; the app runs `moved` after each drawn frame.
    let frame = |rt: &mut Runtime<State>| {
        rt.frame(1.0 / 60.0);
        rubric_app::state::moved(&mut rt.state);
    };
    rt.key(KeyEvent { key: Key::Down, mods: Mods::default() });
    frame(&mut rt);
    frame(&mut rt);
    // Moving within the line sends nothing more.
    rt.key(KeyEvent { key: Key::Right, mods: Mods::default() });
    frame(&mut rt);
    frame(&mut rt);
    let lines: Vec<u64> = std::iter::from_fn(|| sent.try_recv().ok())
        .filter(|m| m["method"] == "rubric/cursor")
        .map(|m| m["params"]["line"].as_u64().unwrap())
        .collect();
    assert_eq!(lines, vec![1]);
}

fn with_ghost(text: &str, line: u32, pin: serde_json::Value) -> (Runtime<State>, std::sync::mpsc::Receiver<serde_json::Value>) {
    let end = rubric_app::position::line_range(text, line).end;
    let mut rt = runtime(text, end);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut rt.state, client);
    rubric_app::state::moved(&mut rt.state);
    let asked = std::iter::from_fn(|| sent.try_recv().ok()).find(|m| m["method"] == "textDocument/inlineCompletion").expect("asked");
    let id = asked["id"].as_i64().unwrap();
    let ch = rubric_app::position::line_char(text, end).1;
    let result = serde_json::json!([{ "insertText": " quote", "range": { "start": { "line": line, "character": ch }, "end": { "line": line, "character": ch } },
        "command": { "title": "Pin", "command": "rubric.pin", "arguments": [pin] } }]);
    rubric_app::state::incoming(&mut rt.state, rubric_app::lsp::Incoming::Response { id, result: Ok(result) });
    rt.frame(1.0 / 60.0);
    (rt, sent)
}

#[test]
fn tab_takes_the_pick_and_sends_the_change() {
    let (mut rt, sent) = with_ghost("a\n::: a quote\n:::", 1, serde_json::json!({ "line": 1, "text": "::: quote" }));
    assert!(rt.find("ghost").is_some(), "the pick shows");
    press(&mut rt, Key::Tab);
    assert_eq!(rt.state.edit.text, "a\n::: quote\n:::");
    assert!(rt.find("ghost").is_none());
    let change = std::iter::from_fn(|| sent.try_recv().ok()).find(|m| m["method"] == "textDocument/didChange").expect("a didChange");
    assert_eq!(change["params"]["contentChanges"][0]["text"], "a\n::: quote\n:::");
    assert!(editor_focused(&rt));
}

#[test]
fn tab_on_a_pick_that_opens_a_menu_changes_nothing() {
    let (mut rt, _sent) = with_ghost("::: some words\n:::", 0, serde_json::json!({ "line": 0, "text": "::: new: some words", "build": true }));
    assert!(rt.find("ghost").is_some(), "shown");
    press(&mut rt, Key::Tab);
    assert_eq!(rt.state.edit.text, "::: some words\n:::");
}

#[test]
fn an_answer_to_an_earlier_question_is_dropped() {
    let text = "::: a quote\n:::";
    let mut rt = runtime(text, 11);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut rt.state, client);
    rubric_app::state::moved(&mut rt.state);
    let id = std::iter::from_fn(|| sent.try_recv().ok()).find(|m| m["method"] == "textDocument/inlineCompletion").unwrap()["id"].as_i64().unwrap();
    rt.ime(Ime::Commit("s".into()));
    rt.frame(1.0 / 60.0);
    let result = serde_json::json!([{ "insertText": " quote", "range": { "start": { "line": 0, "character": 11 } } }]);
    rubric_app::state::incoming(&mut rt.state, rubric_app::lsp::Incoming::Response { id, result: Ok(result) });
    assert!(rt.state.ghost.is_none());
}

fn asks(sent: &std::sync::mpsc::Receiver<serde_json::Value>) -> Vec<i64> {
    std::iter::from_fn(|| sent.try_recv().ok())
        .filter(|m| m["method"] == "textDocument/inlineCompletion")
        .map(|m| m["id"].as_i64().unwrap())
        .collect()
}

/// A frame and what the app's `on_frame_drawn` does after it.
fn step(rt: &mut Runtime<State>) {
    rt.frame(1.0 / 60.0);
    rubric_app::state::moved(&mut rt.state);
    rt.frame(1.0 / 60.0);
}

#[test]
fn leaving_the_line_clears_the_pick_and_coming_back_asks_again() {
    let (mut rt, sent) = with_ghost("a\n::: a quote\n:::", 1, serde_json::json!({ "line": 1, "text": "::: quote" }));
    asks(&sent);
    rt.key(KeyEvent { key: Key::Up, mods: Mods::default() });
    step(&mut rt);
    assert!(rt.state.ghost.is_none());
    assert!(rt.find("ghost").is_none());
    rt.key(KeyEvent { key: Key::Down, mods: Mods::default() });
    rt.key(KeyEvent { key: Key::End, mods: Mods::default() });
    step(&mut rt);
    assert_eq!(asks(&sent).len(), 1, "asked again at the same version");
}

#[test]
fn an_answer_after_the_caret_left_the_line_is_dropped() {
    let text = "a\n::: a quote\n:::";
    let mut rt = runtime(text, 13);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut rt.state, client);
    let id = asks(&sent)[0];
    rt.key(KeyEvent { key: Key::Up, mods: Mods::default() });
    step(&mut rt);
    let result = serde_json::json!([{ "insertText": " quote", "range": { "start": { "line": 1, "character": 11 } } }]);
    rubric_app::state::incoming(&mut rt.state, rubric_app::lsp::Incoming::Response { id, result: Ok(result) });
    assert!(rt.state.ghost.is_none());
}
