//! The app's view in Rune's headless runtime: no window, no web view, no server.

use std::path::PathBuf;

use rune::{Env, Ime, Key, KeyEvent, Mods, Runtime};
use rubric_app::state::State;

pub fn runtime(text: &str, caret: usize) -> Runtime<State> {
    let mut s = State::open(PathBuf::from("/nonexistent/post.md"), text.to_string());
    s.edit.set_caret(caret);
    s.width = 1000.0;
    let mut rt = Runtime::with_text(s, rubric_app::view, (1000.0, 700.0), Env::new(false, 1.0), rubric_app::fonts::text_system());
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
fn tab_on_the_offer_of_a_new_part_makes_the_line_and_asks_for_its_menu() {
    let (mut rt, sent) = with_ghost("::: some words\n:::", 0, serde_json::json!({ "line": 0, "text": "::: new: some words", "build": true }));
    assert!(rt.find("ghost").is_some(), "shown");
    while sent.try_recv().is_ok() {}
    press(&mut rt, Key::Tab);
    assert_eq!(rt.state.edit.text, "::: new: some words\n:::");
    let look = drafts(&sent);
    assert_eq!(look.len(), 1);
    assert_eq!((look[0]["params"]["line"].as_u64(), look[0]["params"].get("action")), (Some(0), None));
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

// The `new:` line's menu.

use rubric_app::lsp::Incoming;
use serde_json::{Value, json};

fn drafts(sent: &std::sync::mpsc::Receiver<Value>) -> Vec<Value> {
    std::iter::from_fn(|| sent.try_recv().ok()).filter(|m| m["method"] == "rubric/draft").collect()
}

fn peeks(sent: &std::sync::mpsc::Receiver<Value>) -> Vec<Value> {
    std::iter::from_fn(|| sent.try_recv().ok()).filter(|m| m["method"] == "rubric/peek").map(|m| m["params"]["part"].clone()).collect()
}

/// The caret at the end of `line` of `text`, a server connected, and nothing sent yet read.
fn on_line(text: &str, line: u32) -> (Runtime<State>, std::sync::mpsc::Receiver<Value>) {
    let mut rt = runtime(text, rubric_app::position::line_range(text, line).end);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut rt.state, client);
    rubric_app::state::moved(&mut rt.state);
    while sent.try_recv().is_ok() {}
    (rt, sent)
}

/// Tab, then the server's view for the line: the menu is open.
fn with_menu(text: &str, line: u32, view: Value) -> (Runtime<State>, std::sync::mpsc::Receiver<Value>) {
    let (mut rt, sent) = on_line(text, line);
    press(&mut rt, Key::Tab);
    let look = drafts(&sent);
    assert_eq!(look.len(), 1, "Tab asks for the line's view");
    assert!(look[0]["params"].get("action").is_none());
    answer(&mut rt, &look[0], view);
    (rt, sent)
}

fn answer(rt: &mut Runtime<State>, request: &Value, result: Value) {
    tell(rt, Incoming::Response { id: request["id"].as_i64().unwrap(), result: Ok(result) });
    rt.frame(1.0 / 60.0);
}

/// A message from the server, as the app takes it: in an update, so the view runs again.
fn tell(rt: &mut Runtime<State>, m: Incoming) {
    rt.update(|s, _| rubric_app::state::incoming(s, m));
    rt.frame(1.0 / 60.0);
}

/// The caret put elsewhere, and what the app's `on_frame_drawn` does about it.
fn caret_to(rt: &mut Runtime<State>, byte: usize) {
    rt.update(|s, _| s.edit.set_caret(byte));
    rt.frame(1.0 / 60.0);
    rt.update_if(|s, _| rubric_app::state::moved(s));
    rt.frame(1.0 / 60.0);
}

fn rows(rt: &Runtime<State>) -> Vec<String> {
    rt.state.menu.as_ref().map(|m| m.rows.iter().map(|r| r.id.clone()).collect()).unwrap_or_default()
}

const NEW: &str = "before\n::: new: a tide clock\n:::\nafter";

#[test]
fn tab_on_a_new_line_opens_its_menu_and_return_drafts() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "drafter": "the stub" }));
    assert_eq!(rows(&rt), ["build", "cancel"]);
    assert!(rt.find("menu-content").is_some(), "the menu is drawn");
    assert!(editor_focused(&rt), "the editor keeps the focus");
    press(&mut rt, Key::Enter);
    let built = drafts(&sent);
    assert_eq!(built.len(), 1);
    assert_eq!((built[0]["params"]["action"].as_str(), built[0]["params"]["line"].as_u64()), (Some("build"), Some(1)));
    assert!(rt.state.menu.is_none());
    assert_eq!(rt.state.edit.text, NEW, "Return went to the menu, not the text");
}

#[test]
fn the_menu_is_drawn_inside_the_writing_pane() {
    let (mut rt, _sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    rt.frame(1.0 / 60.0);
    let menu = rt.elements().into_iter().find(|e| e.key.as_deref() == Some("menu-content")).expect("drawn");
    let divider = rt.find("divider").unwrap().0;
    assert!(menu.rect[0] >= 0.0 && menu.rect[0] + menu.rect[2] <= divider, "{:?} left of the divider at {divider}", menu.rect);
}

#[test]
fn down_moves_in_the_menu_and_leaves_the_caret_where_it_was() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    let caret = rt.state.edit.range();
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.edit.range(), caret);
    assert_eq!(rt.state.menu.as_ref().unwrap().active, 1);
    press(&mut rt, Key::Enter);
    assert_eq!(drafts(&sent)[0]["params"]["action"], "cancel");
}

#[test]
fn a_press_on_a_row_chooses_it_and_typing_stays_in_the_writing() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    for _ in 0..30 {
        rt.frame(1.0 / 60.0);
    }
    let (x, y) = rt.find("menu-option-cancel").expect("the row is drawn");
    rt.pointer_move(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x, y);
    rt.frame(1.0 / 60.0);
    assert_eq!(drafts(&sent)[0]["params"]["action"], "cancel");
    assert!(rt.state.menu.is_none());
    assert!(editor_focused(&rt));
}

#[test]
fn a_typed_letter_closes_the_menu_and_lands_in_the_text() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    press(&mut rt, Key::Text("s".into()));
    assert!(rt.state.menu.is_none());
    assert!(rt.find("menu-content").is_none());
    assert_eq!(rt.state.edit.text, "before\n::: new: a tide clocks\n:::\nafter");
    assert!(drafts(&sent).is_empty(), "nothing was chosen");
}

#[test]
fn esc_closes_the_menu_and_the_caret_leaving_the_line_does_too() {
    let (mut rt, _sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    press(&mut rt, Key::Escape);
    assert!(rt.state.menu.is_none());
    assert_eq!(rt.state.edit.text, NEW);

    let (mut rt, _sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    caret_to(&mut rt, 0);
    assert!(rt.state.menu.is_none());
}

#[test]
fn a_view_that_comes_after_the_caret_left_opens_nothing() {
    let (mut rt, sent) = on_line(NEW, 1);
    press(&mut rt, Key::Tab);
    let look = drafts(&sent);
    caret_to(&mut rt, 0);
    answer(&mut rt, &look[0], json!({ "words": "a tide clock" }));
    assert!(rt.state.menu.is_none());
}

#[test]
fn keep_for_the_site_puts_the_answers_line_in_place_as_one_undo() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock" }));
    assert_eq!(rows(&rt), ["keep", "reroll", "cancel"]);
    press(&mut rt, Key::Enter);
    assert_eq!(rows(&rt), ["site", "all"]);
    press(&mut rt, Key::Enter);
    let keep = drafts(&sent);
    assert_eq!((keep[0]["params"]["action"].as_str(), keep[0]["params"]["global"].as_bool()), (Some("keep"), Some(false)));
    // A line typed above while the server worked: the answer follows the line down.
    rt.state.edit.set_caret(0);
    rt.ime(Ime::Commit("x\n".into()));
    rt.frame(1.0 / 60.0);
    let version = rt.state.version;
    answer(&mut rt, &keep[0], json!({ "replace": "::: tide-clock", "part": { "name": "tide-clock", "settings": [] } }));
    assert_eq!(rt.state.edit.text, "x\nbefore\n::: tide-clock\n:::\nafter");
    assert_eq!(rt.state.version, version + 1, "the server is told");
    assert!(rt.state.flash.as_ref().is_some_and(|f| f.1.contains("tide-clock")), "kept is said");
    rt.state.edit.undo();
    assert_eq!(rt.state.edit.text, "x\nbefore\n::: new: a tide clock\n:::\nafter");
}

#[test]
fn every_theme_sends_global() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock" }));
    press(&mut rt, Key::Enter);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    assert_eq!(drafts(&sent)[0]["params"]["global"], true);
}

#[test]
fn an_answer_nothing_asked_for_is_ignored_and_an_error_is_said() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock" }));
    tell(&mut rt, Incoming::Response { id: 9999, result: Ok(json!({ "replace": "::: wrong" })) });
    assert_eq!(rt.state.edit.text, NEW);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    let cancel = drafts(&sent);
    answer(&mut rt, &cancel[0], json!({ "error": "no draft here" }));
    assert_eq!(rt.state.edit.text, NEW);
    assert!(rt.state.flash.as_ref().is_some_and(|f| f.1.contains("no draft here")));
}

#[test]
fn similar_parts_peek_each_row_and_choosing_uses_the_part() {
    let near = json!([{ "name": "quote", "description": "A quote", "own": false }, { "name": "aside", "description": "An aside", "own": true }]);
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "near": near }));
    assert_eq!(rows(&rt), ["near", "build", "cancel"]);
    press(&mut rt, Key::Enter);
    assert_eq!(rows(&rt), ["quote", "aside"]);
    assert_eq!(peeks(&sent), [json!("quote")], "the first is drawn at once");
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    assert_eq!(peeks(&sent), [json!("aside")], "one for the row moved to, none at the end");
    press(&mut rt, Key::Escape);
    assert_eq!(peeks(&sent), [Value::Null], "Esc ends the look");
    assert_eq!(rows(&rt), ["near", "build", "cancel"], "and goes back to the first menu");
    press(&mut rt, Key::Enter);
    peeks(&sent);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    let all: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    let used = all.iter().find(|m| m["method"] == "rubric/draft").expect("use is sent");
    assert_eq!((used["params"]["action"].as_str(), used["params"]["part"].as_str()), (Some("use"), Some("aside")));
}

#[test]
fn notes_typed_for_a_reroll_go_with_it_and_not_into_the_writing() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock" }));
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    assert_eq!(rows(&rt), ["just", "notes"]);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    rt.frame(1.0 / 60.0);
    assert!(rt.elements().into_iter().any(|e| e.key.as_deref() == Some("notes") && e.focused), "the notes field has the focus");
    rt.ime(Ime::Commit("name it tide-two".into()));
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.edit.text, NEW);
    press(&mut rt, Key::Enter);
    let reroll = drafts(&sent);
    assert_eq!((reroll[0]["params"]["action"].as_str(), reroll[0]["params"]["change"].as_str()), (Some("reroll"), Some("name it tide-two")));
    rt.frame(1.0 / 60.0);
    assert!(editor_focused(&rt), "typing goes to the writing again");
    assert!(rt.state.menu.is_none());
}

#[test]
fn esc_in_the_notes_goes_back_to_the_reroll_menu_and_sends_nothing() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock" }));
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    rt.frame(1.0 / 60.0);
    rt.ime(Ime::Commit("words".into()));
    press(&mut rt, Key::Escape);
    rt.frame(1.0 / 60.0);
    assert_eq!(rows(&rt), ["just", "notes"]);
    assert!(editor_focused(&rt));
    assert!(drafts(&sent).is_empty());
    press(&mut rt, Key::Enter);
    assert_eq!(drafts(&sent)[0]["params"]["change"], "", "a plain reroll after all");
}

// The line's status.

fn diagnostics(rt: &mut Runtime<State>, list: Value) {
    let uri = rt.state.uri.clone();
    tell(rt, Incoming::Notification { method: "textDocument/publishDiagnostics".into(), params: json!({ "uri": uri, "diagnostics": list }) });
}

fn ready(line: u32) -> Value {
    json!([{ "source": "rubric", "code": "draft-ready", "range": { "start": { "line": line, "character": 0 } }, "data": { "name": "tide-clock" } }])
}

#[test]
fn the_status_shows_only_while_the_caret_is_on_a_new_line() {
    let (mut rt, _sent) = on_line(NEW, 1);
    rt.frame(1.0 / 60.0);
    assert!(rt.find("status-words").is_some());
    let before = rubric_app::draft::line(&rt.state).unwrap();
    diagnostics(&mut rt, ready(1));
    let after = rubric_app::draft::line(&rt.state).unwrap();
    assert_ne!(before, after, "the server's word for the line changes what is said");
    assert!(after.1.contains("tide-clock"));
    caret_to(&mut rt, 0);
    assert!(rt.find("status-words").is_none());
}

#[test]
fn a_draft_finished_on_another_line_is_said_for_a_while() {
    let (mut rt, _sent) = on_line(NEW, 0);
    let drafted = json!({ "status": "ready", "name": "tide-clock", "words": "a tide clock" });
    tell(&mut rt, Incoming::Notification { method: "rubric/drafted".into(), params: drafted.clone() });
    let (_, said, _, until) = rt.state.flash.clone().expect("said");
    assert!(said.contains("tide-clock"));
    // It goes once its time has passed.
    rt.state.flash.as_mut().unwrap().3 = 0;
    rubric_app::draft::tick(&mut rt.state);
    assert!(rt.state.flash.is_none() && until > 0);

    // On the line itself, its own status says it.
    let (mut rt, _sent) = on_line(NEW, 1);
    tell(&mut rt, Incoming::Notification { method: "rubric/drafted".into(), params: drafted });
    assert!(rt.state.flash.is_none());
}

#[test]
fn diagnostics_reach_a_post_whose_path_the_server_escapes_differently() {
    let mut s = State::open(PathBuf::from("/home/a/My Site (2)/it's+me.md"), NEW.to_string());
    let (client, _sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut s, client);
    // As Node's pathToFileURL writes it: the space escaped, the rest not.
    let params = json!({ "uri": "file:///home/a/My%20Site%20(2)/it's+me.md", "diagnostics": ready(1) });
    rubric_app::state::incoming(&mut s, Incoming::Notification { method: "textDocument/publishDiagnostics".into(), params });
    assert_eq!(s.drafts.len(), 1);
}

#[test]
fn diagnostics_for_another_document_change_nothing() {
    let (mut rt, _sent) = on_line(NEW, 1);
    tell(&mut rt, Incoming::Notification { method: "textDocument/publishDiagnostics".into(), params: json!({ "uri": "file:///other.md", "diagnostics": ready(1) }) });
    assert!(rt.state.drafts.is_empty());
}

// The look.

fn text_of(rt: &Runtime<State>, key: &str) -> Option<String> {
    rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).and_then(|e| e.text)
}

#[test]
fn the_title_row_says_saved_only_while_the_text_is_as_written() {
    let dir = std::env::temp_dir().join(format!("rubric-app-title-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("walk.md");
    std::fs::write(&path, "# The long walk\n\nbody").unwrap();
    let mut s = State::open(path.clone(), "# The long walk\n\nbody".into());
    s.edit.set_caret(21);
    s.width = 1000.0;
    let mut rt = Runtime::with_text(s, rubric_app::view, (1000.0, 700.0), Env::new(false, 1.0), rubric_app::fonts::text_system());
    rt.frame(0.0);
    assert_eq!(text_of(&rt, "title").as_deref(), Some("The long walk"));
    assert!(rt.find("saved").is_some());
    rt.ime(Ime::Commit("x".into()));
    rt.frame(1.0 / 60.0);
    assert!(rt.find("saved").is_none(), "changed since it was written");
    rt.key(KeyEvent { key: Key::Command('s'), mods: Mods { cmd: true, ..Mods::default() } });
    rt.frame(1.0 / 60.0);
    assert!(rt.find("saved").is_some(), "written again");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "# The long walk\n\nbodyx");
    std::fs::remove_dir_all(&dir).unwrap();
}

// The panel, and the list of app themes in it.

use rubric_app::panel::{Item, Panel, Row};
use rubric_app::theme::{Look, Mode};

fn fill_of(rt: &Runtime<State>, key: &str) -> rune::Color {
    rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).unwrap_or_else(|| panic!("no {key}")).fill
}

fn config(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("rubric-app-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn themed(dir: &std::path::Path) -> Runtime<State> {
    let mut rt = runtime("# Hi\n\nbody", 4);
    let look = Look::load(Some(dir.to_path_buf()), None, Mode::Light);
    rt.update(|s, _| rubric_app::state::set_look(s, look));
    rt.frame(1.0 / 60.0);
    rt
}

fn cmd(rt: &mut Runtime<State>, key: Key) {
    rt.key(KeyEvent { key, mods: Mods { cmd: true, ..Mods::default() } });
    rt.frame(1.0 / 60.0);
}

#[test]
fn moving_in_the_theme_list_draws_the_app_in_that_theme_and_esc_goes_back() {
    let dir = config("themes-esc");
    let mut rt = themed(&dir);
    let paper = fill_of(&rt, "writing-pane");
    cmd(&mut rt, Key::Command(','));
    assert_eq!(rt.state.panels.len(), 1);
    assert!(rt.find("panel-0").is_some(), "the list is drawn");
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.look.name, "ink");
    let ink = fill_of(&rt, "writing-pane");
    assert_ne!(ink, paper);
    assert_eq!(ink, Look::load(None, Some("ink".into()), Mode::Light).palette.pane);
    press(&mut rt, Key::Escape);
    assert!(rt.state.panels.is_empty());
    assert_eq!(fill_of(&rt, "writing-pane"), paper);
    assert!(!dir.join("app.json").exists(), "nothing written");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn return_in_the_theme_list_keeps_the_theme_for_the_next_start() {
    let dir = config("themes-keep");
    let mut rt = themed(&dir);
    cmd(&mut rt, Key::Command(','));
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    assert!(rt.state.panels.is_empty());
    assert_eq!(rt.state.look.name, "sepia");
    assert_eq!(Look::load(Some(dir.clone()), None, Mode::Light).name, "sepia", "a new start reads it");
    assert_eq!(rt.state.edit.text, "# Hi\n\nbody", "Return went to the list");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_typed_letter_closes_the_theme_list_restores_the_theme_and_lands_in_the_text() {
    let dir = config("themes-type");
    let mut rt = themed(&dir);
    cmd(&mut rt, Key::Command(','));
    press(&mut rt, Key::Down);
    rt.ime(Ime::Commit("x".into()));
    rt.frame(1.0 / 60.0);
    assert!(rt.state.panels.is_empty());
    assert_eq!(rt.state.look.name, "paper");
    assert_eq!(rt.state.edit.text, "# Hix\n\nbody");
    std::fs::remove_dir_all(&dir).unwrap();
}

fn controls() -> Panel {
    Panel::new("test", "Test", 260.0, vec![
        Row::Field { id: "words".into(), label: None, placeholder: "words".into() },
        Row::Seg { id: "size".into(), label: "Size".into(), choices: vec!["Normal".into(), "Large".into(), "Huge".into()], on: 0 },
        Row::Item(Item::new("keep", "Keep")),
    ])
}

#[test]
fn a_press_on_a_segment_sets_that_segment() {
    let mut rt = runtime("text", 4);
    rt.update(|s, _| s.panels = vec![controls()]);
    for _ in 0..20 {
        rt.frame(1.0 / 60.0);
    }
    let (x, y) = rt.find("row-test-size-2").expect("the segment is drawn");
    rt.pointer_move(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x, y);
    rt.frame(1.0 / 60.0);
    assert!(matches!(rt.state.panels[0].rows[1], Row::Seg { on: 2, .. }), "{:?}", rt.state.panels[0].rows[1]);
}

#[test]
fn typing_in_a_panels_field_leaves_the_writing_alone() {
    let mut rt = runtime("text", 4);
    rt.update(|s, tx| {
        s.panels = vec![controls()];
        tx.focus("panel-field", false);
    });
    rt.frame(1.0 / 60.0);
    rt.ime(Ime::Commit("torn".into()));
    rt.frame(1.0 / 60.0);
    press(&mut rt, Key::Backspace);
    assert_eq!(rt.state.field.text, "tor");
    assert_eq!(rt.state.edit.text, "text");
    assert_eq!(rt.state.version, 1);
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.panels[0].active_id(), Some("size"));
    assert!(editor_focused(&rt), "off the field, the editor has the keys again");
    press(&mut rt, Key::Escape);
    assert!(rt.state.panels.is_empty());
}

#[test]
fn panels_are_drawn_inside_the_writing_pane() {
    let mut rt = runtime("text", 4);
    let mut second = controls();
    second.id = "second".into();
    second.from = Some(2);
    rt.update(|s, _| {
        s.split = 0.9;
        s.panels = vec![controls(), second];
    });
    for _ in 0..20 {
        rt.frame(1.0 / 60.0);
    }
    let pane = rt.state.pane;
    for key in ["panel-0", "panel-1"] {
        let r = rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).unwrap_or_else(|| panic!("no {key}")).rect;
        assert!(r[0] >= pane[0] && r[0] + r[2] <= pane[0] + pane[2] && r[1] >= pane[1] && r[1] + r[3] <= pane[1] + pane[3], "{key} {r:?} in {pane:?}");
    }
}

#[test]
fn in_a_narrow_pane_the_second_panel_replaces_the_first_and_its_back_row_goes_back() {
    let mut rt = runtime("text", 4);
    let mut second = controls();
    second.id = "second".into();
    second.from = Some(2);
    rt.update(|s, _| s.panels = vec![controls(), second]);
    for _ in 0..20 {
        rt.frame(1.0 / 60.0);
    }
    assert!(rt.find("panel-0").is_none() && rt.find("panel-1").is_some());
    let (x, y) = rt.find("panel-back").expect("a row back");
    rt.pointer_move(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x, y);
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.panels.len(), 1);
    assert_eq!(rt.state.panels[0].id, "test");
}
