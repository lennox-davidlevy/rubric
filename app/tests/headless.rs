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

fn field_focused(rt: &Runtime<State>) -> bool {
    rt.elements().into_iter().any(|e| e.key.as_deref() == Some("panel-field") && e.focused)
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
fn a_pick_with_a_starter_draws_one_line_and_tab_puts_the_starter_in() {
    let text = "a\n::: three numbered steps\n:::\nbody";
    let end = rubric_app::position::line_range(text, 1).end;
    let mut rt = runtime(text, end);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rubric_app::state::connected(&mut rt.state, client);
    rubric_app::state::moved(&mut rt.state);
    let asked = std::iter::from_fn(|| sent.try_recv().ok()).find(|m| m["method"] == "textDocument/inlineCompletion").expect("asked");
    let id = asked["id"].as_i64().unwrap();
    let ch = rubric_app::position::line_char(text, end).1;
    let show = " → steps\n### The first step\n\nWhat to do.";
    let result = serde_json::json!([{
        "insertText": show,
        "range": { "start": { "line": 1, "character": ch }, "end": { "line": 1, "character": ch } },
        "command": { "title": "Pin", "command": "rubric.pin", "arguments": [{ "line": 1, "text": "::: steps" }] }
    }]);
    rubric_app::state::incoming(&mut rt.state, rubric_app::lsp::Incoming::Response { id, result: Ok(result) });
    rt.frame(1.0 / 60.0);
    let shown = text_of(&rt, "ghost").expect("ghost drawn");
    assert_eq!(shown, " → steps");
    assert!(!shown.contains('\n'), "ghost text is one line: {shown:?}");
    press(&mut rt, Key::Tab);
    assert_eq!(rt.state.edit.text, "a\n::: steps\n### The first step\n\nWhat to do.\n:::\nbody");
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
    rt.update(|s, tx| {
        rubric_app::state::incoming(s, m);
        rubric_app::state::follow_up(s, tx);
    });
    rt.frame(1.0 / 60.0);
}

/// The caret put elsewhere, and what the app's `on_frame_drawn` does about it.
fn caret_to(rt: &mut Runtime<State>, byte: usize) {
    rt.update(|s, _| s.edit.set_caret(byte));
    rt.frame(1.0 / 60.0);
    rt.update_if(|s, _| rubric_app::state::moved(s));
    rt.frame(1.0 / 60.0);
}

/// The ids of the rows of the top panel that take the focus.
fn rows(rt: &Runtime<State>) -> Vec<String> {
    rt.state.panels.last().map(|p| p.rows.iter().filter(|r| r.takes_focus()).filter_map(|r| r.id().map(str::to_string)).collect()).unwrap_or_default()
}

fn top(rt: &Runtime<State>) -> Option<String> {
    rt.state.panels.last().map(|p| p.id.clone())
}

fn settle(rt: &mut Runtime<State>) {
    for _ in 0..30 {
        rt.frame(1.0 / 60.0);
    }
}

fn click(rt: &mut Runtime<State>, key: &str) {
    settle(rt);
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("{key} is drawn"));
    rt.pointer_move(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_up(x, y);
    rt.frame(1.0 / 60.0);
}

const NEW: &str = "before\n::: new: a tide clock\n:::\nafter";
const READY: fn() -> Value = || json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock", "drafter": "opus, low" });

#[test]
fn tab_on_a_new_line_opens_its_menu_and_return_drafts() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "drafter": "opus, low" }));
    assert_eq!(rows(&rt), ["build"]);
    assert!(rt.find("panel-0").is_some(), "the menu is drawn");
    assert!(editor_focused(&rt), "the editor keeps the focus");
    press(&mut rt, Key::Enter);
    let built = drafts(&sent);
    assert_eq!(built.len(), 1);
    assert_eq!((built[0]["params"]["action"].as_str(), built[0]["params"]["line"].as_u64()), (Some("build"), Some(1)));
    assert!(built[0]["params"].get("drafter").is_none(), "the writer's default drafts it");
    assert!(rt.state.panels.is_empty());
    assert_eq!(rt.state.edit.text, NEW, "Return went to the menu, not the text");
}

#[test]
fn the_menu_is_drawn_inside_the_writing_pane() {
    let (mut rt, _sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    settle(&mut rt);
    let menu = rt.elements().into_iter().find(|e| e.key.as_deref() == Some("panel-0")).expect("drawn");
    let divider = rt.find("divider").unwrap().0;
    assert!(menu.rect[0] >= 0.0 && menu.rect[0] + menu.rect[2] <= divider, "{:?} left of the divider at {divider}", menu.rect);
}

#[test]
fn down_moves_in_the_menu_and_leaves_the_caret_where_it_was() {
    let (mut rt, sent) = with_menu(NEW, 1, READY());
    let caret = rt.state.edit.range();
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.edit.range(), caret);
    assert_eq!(rt.state.panels[0].active_id(), Some("reroll"));
    press(&mut rt, Key::Enter);
    let reroll = drafts(&sent);
    assert_eq!((reroll[0]["params"]["action"].as_str(), reroll[0]["params"]["change"].as_str()), (Some("reroll"), Some("")));
}

#[test]
fn a_press_on_a_row_chooses_it_and_typing_stays_in_the_writing() {
    let (mut rt, sent) = with_menu(NEW, 1, READY());
    click(&mut rt, &rubric_app::look::row_key("draft", "cancel"));
    assert_eq!(drafts(&sent)[0]["params"]["action"], "cancel");
    assert!(rt.state.panels.is_empty());
    assert!(editor_focused(&rt));
}

#[test]
fn a_rows_key_chooses_it_from_another_row() {
    let (mut rt, sent) = with_menu(NEW, 1, READY());
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    cmd(&mut rt, Key::Command('r'));
    assert_eq!(drafts(&sent)[0]["params"]["action"], "reroll");
}

#[test]
fn a_typed_letter_closes_the_menu_and_lands_in_the_text() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    press(&mut rt, Key::Text("s".into()));
    assert!(rt.state.panels.is_empty());
    assert!(rt.find("panel-0").is_none());
    assert_eq!(rt.state.edit.text, "before\n::: new: a tide clocks\n:::\nafter");
    assert!(drafts(&sent).is_empty(), "nothing was chosen");
}

#[test]
fn esc_closes_the_menu_and_the_caret_leaving_the_line_does_too() {
    let (mut rt, _sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    press(&mut rt, Key::Escape);
    assert!(rt.state.panels.is_empty());
    assert_eq!(rt.state.edit.text, NEW);

    let (mut rt, _sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    caret_to(&mut rt, 0);
    assert!(rt.state.panels.is_empty());
}

#[test]
fn a_view_that_comes_after_the_caret_left_opens_nothing() {
    let (mut rt, sent) = on_line(NEW, 1);
    press(&mut rt, Key::Tab);
    let look = drafts(&sent);
    caret_to(&mut rt, 0);
    answer(&mut rt, &look[0], json!({ "words": "a tide clock" }));
    assert!(rt.state.panels.is_empty());
}

#[test]
fn keep_asks_nothing_and_puts_the_answers_line_in_place_as_one_undo() {
    let (mut rt, sent) = with_menu(NEW, 1, READY());
    assert_eq!(rows(&rt), ["keep", "reroll", "notes", "cancel"]);
    press(&mut rt, Key::Enter);
    let keep = drafts(&sent);
    assert_eq!((keep[0]["params"]["action"].as_str(), keep[0]["params"]["global"].as_bool()), (Some("keep"), Some(false)));
    assert!(rt.state.panels.is_empty(), "kept for the site, nothing asked");
    // A line typed above while the server worked: the answer follows the line down.
    rt.state.edit.set_caret(0);
    rt.ime(Ime::Commit("x\n".into()));
    rt.frame(1.0 / 60.0);
    let version = rt.state.version;
    answer(&mut rt, &keep[0], json!({ "replace": "::: tide-clock", "part": { "name": "tide-clock", "settings": [] } }));
    assert_eq!(rt.state.edit.text, "x\nbefore\n::: tide-clock\n:::\nafter");
    assert_eq!(rt.state.version, version + 1, "the server is told");
    assert!(rt.state.flash.as_ref().is_some_and(|f| f.0.fact.contains("Tide clock")), "kept is said");
    rt.state.edit.undo();
    assert_eq!(rt.state.edit.text, "x\nbefore\n::: new: a tide clock\n:::\nafter");
}

#[test]
fn an_answer_nothing_asked_for_is_ignored_and_an_error_is_said() {
    let (mut rt, sent) = with_menu(NEW, 1, READY());
    tell(&mut rt, Incoming::Response { id: 9999, result: Ok(json!({ "replace": "::: wrong" })) });
    assert_eq!(rt.state.edit.text, NEW);
    rt.update(|s, _| { s.panels[0].focus("cancel"); });
    press(&mut rt, Key::Enter);
    let cancel = drafts(&sent);
    answer(&mut rt, &cancel[0], json!({ "error": "no draft here" }));
    assert_eq!(rt.state.edit.text, NEW);
    assert!(rt.state.flash.as_ref().is_some_and(|f| f.0.fact.contains("draft here")));
}

#[test]
fn similar_parts_peek_each_row_and_choosing_uses_the_part() {
    let near = json!([{ "name": "quote", "description": "A quote", "own": false }, { "name": "aside", "description": "An aside", "own": true }]);
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "near": near }));
    assert_eq!(rows(&rt), ["build", "near"]);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Right);
    assert_eq!((top(&rt).as_deref(), rows(&rt)), (Some("near"), vec!["quote".to_string(), "aside".to_string()]));
    assert_eq!(peeks(&sent), [json!("quote")], "the first is drawn at once");
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    assert_eq!(peeks(&sent), [json!("aside")], "one for the row moved to, none at the end");
    press(&mut rt, Key::Escape);
    assert_eq!(peeks(&sent), [Value::Null], "Esc ends the look");
    assert_eq!(top(&rt).as_deref(), Some("draft"), "and goes back to the menu");
    press(&mut rt, Key::Enter);
    peeks(&sent);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    let all: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    let used = all.iter().find(|m| m["method"] == "rubric/draft").expect("use is sent");
    assert_eq!((used["params"]["action"].as_str(), used["params"]["part"].as_str()), (Some("use"), Some("aside")));
}

#[test]
fn a_typed_letter_in_similar_parts_ends_the_look() {
    let near = json!([{ "name": "quote", "description": "A quote", "own": false }]);
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "near": near }));
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    peeks(&sent);
    press(&mut rt, Key::Text("s".into()));
    assert!(rt.state.panels.is_empty());
    assert_eq!(peeks(&sent), [Value::Null]);
}

#[test]
fn notes_typed_for_a_reroll_go_with_it_and_not_into_the_writing() {
    let (mut rt, sent) = with_menu(NEW, 1, READY());
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    rt.frame(1.0 / 60.0);
    assert_eq!(top(&rt).as_deref(), Some("notes"));
    assert!(editor_focused(&rt), "reaching the field moves no focus");
    rt.ime(Ime::Commit("name it tide-two".into()));
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.edit.text, NEW);
    assert!(field_focused(&rt), "typed on, the field has the keys");
    press(&mut rt, Key::Enter);
    let reroll = drafts(&sent);
    assert_eq!((reroll[0]["params"]["action"].as_str(), reroll[0]["params"]["change"].as_str()), (Some("reroll"), Some("name it tide-two")));
    rt.frame(1.0 / 60.0);
    assert!(editor_focused(&rt), "typing goes to the writing again");
    assert!(rt.state.panels.is_empty());
}

#[test]
fn esc_in_the_notes_goes_back_to_the_menu_and_sends_nothing() {
    let (mut rt, sent) = with_menu(NEW, 1, READY());
    rt.update(|s, _| { s.panels[0].focus("notes"); });
    press(&mut rt, Key::Enter);
    rt.frame(1.0 / 60.0);
    rt.ime(Ime::Commit("words".into()));
    press(&mut rt, Key::Escape);
    rt.frame(1.0 / 60.0);
    assert_eq!(top(&rt).as_deref(), Some("draft"));
    assert!(editor_focused(&rt));
    assert!(drafts(&sent).is_empty());
}

const TAKES: fn() -> Value = || json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock", "take": 2, "takes": 3,
    "list": [{ "at": 1, "by": "opus, low" }, { "at": 2, "by": "sonnet, low", "change": "bigger" }, { "at": 3 }] });

fn takes_open() -> (Runtime<State>, std::sync::mpsc::Receiver<Value>) {
    let (mut rt, sent) = with_menu(NEW, 1, TAKES());
    assert_eq!(rows(&rt), ["keep", "reroll", "notes", "takes", "cancel"]);
    rt.update(|s, _| { s.panels[0].focus("takes"); });
    press(&mut rt, Key::Enter);
    assert_eq!(top(&rt).as_deref(), Some("takes"));
    assert_eq!(rt.state.panels[1].active_id(), Some("take-2"), "the focus on the take shown");
    (rt, sent)
}

#[test]
fn moving_in_takes_sends_one_take_a_row_and_esc_sends_the_one_shown_first() {
    let (mut rt, sent) = takes_open();
    assert!(drafts(&sent).is_empty(), "opening asks for nothing");
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Up);
    press(&mut rt, Key::Up);
    let to: Vec<u64> = drafts(&sent).iter().map(|m| {
        assert_eq!(m["params"]["action"], "take");
        m["params"]["to"].as_u64().unwrap()
    }).collect();
    assert_eq!(to, [3, 2, 1], "one a row moved to, none at the end");
    press(&mut rt, Key::Escape);
    let back = drafts(&sent);
    assert_eq!((back.len(), back[0]["params"]["to"].as_u64()), (1, Some(2)));
    assert_eq!(top(&rt).as_deref(), Some("draft"));
}

#[test]
fn return_in_takes_stays_on_that_take() {
    let (mut rt, sent) = takes_open();
    press(&mut rt, Key::Down);
    let moved = drafts(&sent);
    answer(&mut rt, &moved[0], json!({ "words": "a tide clock", "status": "ready", "name": "tide-three", "take": 3, "takes": 3 }));
    press(&mut rt, Key::Enter);
    assert!(drafts(&sent).is_empty(), "nothing more is sent");
    assert_eq!(top(&rt).as_deref(), Some("draft"));
    assert_eq!(rt.state.view.as_ref().unwrap().view.take, Some(3));
}

fn offer(rt: &mut Runtime<State>, sent: &std::sync::mpsc::Receiver<Value>, harness: &str, models: &[&str], efforts: &[&str]) {
    let all: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    for m in &all {
        match m["method"].as_str() {
            Some("rubric/harnesses") => answer(rt, m, json!([{ "name": "claude", "version": "2.1" }, { "name": "opencode", "version": null }])),
            Some("rubric/drafter") => answer(rt, m, json!({ "harness": harness, "model": "opus", "effort": "low", "short": "opus, low",
                "harnesses": ["claude", "opencode"], "models": models, "efforts": efforts })),
            _ => {}
        }
    }
}

#[test]
fn a_drafter_chosen_rides_on_that_lines_build_and_reroll_and_not_on_the_next_lines() {
    let two = "::: new: a tide clock\n:::\n::: new: a bell\n:::";
    let (mut rt, sent) = with_menu(two, 0, json!({ "words": "a tide clock", "drafter": "opus, low" }));
    press(&mut rt, Key::Right);
    offer(&mut rt, &sent, "claude", &["opus", "sonnet"], &["low", "medium", "high"]);
    assert_eq!(top(&rt).as_deref(), Some("drafter"));
    rt.update(|s, _| { s.panels[1].focus("model:sonnet"); });
    press(&mut rt, Key::Enter);
    offer(&mut rt, &sent, "claude", &["opus", "sonnet"], &["low", "medium", "high"]);
    rt.update(|s, _| { s.panels[1].focus("effort"); });
    press(&mut rt, Key::Right);
    press(&mut rt, Key::Right);
    assert!(rt.state.panels[0].rows.iter().any(|r| matches!(r, rubric_app::panel::Row::Item(i) if i.chip.as_deref() == Some("Sonnet · high"))), "the chip names it");
    press(&mut rt, Key::Escape);
    assert!(drafts(&sent).is_empty(), "choosing sends no draft");
    press(&mut rt, Key::Enter);
    let built = drafts(&sent);
    assert_eq!(built[0]["params"]["action"], "build");
    assert_eq!(built[0]["params"]["drafter"], json!({ "harness": "claude", "model": "sonnet", "effort": "high" }));

    // The same line ready: its reroll carries it too.
    press(&mut rt, Key::Tab);
    let look = drafts(&sent);
    answer(&mut rt, &look[0], READY());
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    assert_eq!(drafts(&sent)[0]["params"]["drafter"]["model"], "sonnet");

    // The next line starts from the default.
    caret_to(&mut rt, "::: new: a tide clock\n:::\n::: new: a bell".len());
    press(&mut rt, Key::Tab);
    let look = drafts(&sent);
    answer(&mut rt, &look[0], json!({ "words": "a bell", "drafter": "opus, low" }));
    press(&mut rt, Key::Enter);
    assert!(drafts(&sent)[0]["params"].get("drafter").is_none());
}

#[test]
fn esc_in_the_drafters_panel_sends_nothing() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "drafter": "opus, low" }));
    click(&mut rt, "chip-0-0");
    offer(&mut rt, &sent, "claude", &["opus"], &["low"]);
    assert_eq!(top(&rt).as_deref(), Some("drafter"), "the chip opens it");
    press(&mut rt, Key::Escape);
    assert_eq!(top(&rt).as_deref(), Some("draft"));
    let after: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    assert!(after.is_empty(), "{after:?}");
}

#[test]
fn a_tool_that_is_not_installed_cannot_be_chosen() {
    let (mut rt, sent) = with_menu(NEW, 1, json!({ "words": "a tide clock", "drafter": "opus, low" }));
    press(&mut rt, Key::Right);
    offer(&mut rt, &sent, "claude", &["opus", "sonnet"], &["low"]);
    assert_eq!(rt.state.panels[1].active_id(), Some("tool:claude"));
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.panels[1].active_id(), Some("model:opus"), "the keys pass over it");
    click(&mut rt, "row-drafter-tool:opencode");
    let after: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    assert!(after.is_empty(), "{after:?}");
    assert!(rt.state.choice.is_none());
    assert_eq!(top(&rt).as_deref(), Some("drafter"));
}

#[test]
fn the_status_lines_key_acts_without_the_menu() {
    let (mut rt, sent) = on_line(NEW, 1);
    diagnostics(&mut rt, json!([{ "source": "rubric", "code": "drafting", "range": { "start": { "line": 1, "character": 0 } }, "data": { "started": 0 } }]));
    assert!(rt.find("status-action").is_some());
    cmd(&mut rt, Key::Command('.'));
    assert_eq!(drafts(&sent)[0]["params"]["action"], "stop");
    assert_eq!(rt.state.edit.text, NEW);
    diagnostics(&mut rt, ready(1));
    cmd(&mut rt, Key::Command('.'));
    assert!(drafts(&sent).is_empty(), "only the action shown has its key");
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
    assert_ne!(before.label, after.label, "the server's word for the line changes what is said");
    assert_eq!(after.tone, rubric_app::draft::Tone::Accent);
    caret_to(&mut rt, 0);
    assert!(rt.find("status-words").is_none());
}

#[test]
fn the_status_follows_a_variant_drafting_on_a_parts_line_with_its_one_action() {
    let text = "before\n::: quote : torn edge\nWords.\n:::";
    let (mut rt, sent) = on_line(text, 1);
    assert!(rubric_app::draft::line(&rt.state).is_none(), "a part with nothing drafting says nothing");
    let note = |code: &str| json!([{ "source": "rubric", "code": code, "range": { "start": { "line": 1, "character": 0 } },
        "data": { "name": "quote-torn-edge", "of": "quote", "variant": true, "started": 0, "message": "no part" } }]);
    diagnostics(&mut rt, note("drafting"));
    let said = rubric_app::draft::line(&rt.state).expect("said");
    assert!(said.label.starts_with("Drafting"));
    assert!(said.fact.starts_with("Quote"));
    cmd(&mut rt, Key::Command('.'));
    let stop = drafts(&sent);
    assert_eq!((stop[0]["params"]["action"].as_str(), stop[0]["params"]["line"].as_u64()), (Some("stop"), Some(1)));
    diagnostics(&mut rt, note("draft-ready"));
    assert_eq!(rubric_app::draft::line(&rt.state).unwrap().label, "Ready");
    cmd(&mut rt, Key::Enter);
    assert_eq!(drafts(&sent)[0]["params"]["action"], "keep");
    diagnostics(&mut rt, note("draft-failed"));
    let failed = rubric_app::draft::line(&rt.state).unwrap();
    assert_eq!(failed.tone, rubric_app::draft::Tone::Warn);
    cmd(&mut rt, Key::Command('r'));
    assert_eq!(drafts(&sent)[0]["params"]["action"], "reroll");
}

#[test]
fn a_draft_finished_on_another_line_is_said_for_a_while() {
    let (mut rt, _sent) = on_line(NEW, 0);
    let drafted = json!({ "status": "ready", "name": "tide-clock", "words": "a tide clock" });
    tell(&mut rt, Incoming::Notification { method: "rubric/drafted".into(), params: drafted.clone() });
    let (said, until) = rt.state.flash.clone().expect("said");
    assert!(said.fact.contains("Tide clock"));
    assert!(said.action.is_none(), "nothing to press");
    // It goes once its time has passed.
    rt.state.flash.as_mut().unwrap().1 = 0;
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
    let look = Look::load(Some(dir.to_path_buf()), None, None);
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
    // Ink, which has no light, is passed over.
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.look.name, "sepia");
    let sepia = fill_of(&rt, "writing-pane");
    assert_ne!(sepia, paper);
    assert_eq!(sepia, Look::load(None, Some("sepia".into()), None).palette.pane);
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
    cmd(&mut rt, Key::Command('t'));
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    assert!(rt.state.panels.is_empty());
    assert_eq!(rt.state.look.name, "sepia");
    assert_eq!(Look::load(Some(dir.clone()), None, None).name, "sepia", "a new start reads it");
    assert_eq!(rt.state.edit.text, "# Hi\n\nbody", "Return went to the list");
    std::fs::remove_dir_all(&dir).unwrap();
}

fn off(rt: &Runtime<State>, id: &str) -> bool {
    rt.state.panels[0].rows.iter().any(|r| matches!(r, Row::Item(i) if i.id == id && i.off))
}

#[test]
fn a_theme_with_one_mode_is_dimmed_in_the_other_and_passed_over() {
    let dir = config("themes-modes");
    let mut rt = themed(&dir);
    cmd(&mut rt, Key::Command('t'));
    assert!(!off(&rt, "paper") && off(&rt, "ink"), "light: the dark-only themes are dimmed");
    // Up from Paper to Mode, then Right: dark.
    press(&mut rt, Key::Up);
    assert_eq!(rt.state.panels[0].active_id(), Some("mode"));
    let paper = fill_of(&rt, "writing-pane");
    press(&mut rt, Key::Right);
    assert_eq!(rt.state.look.mode, Mode::Dark);
    assert!(off(&rt, "paper") && off(&rt, "sepia") && !off(&rt, "ink") && !off(&rt, "fjord"));
    assert_eq!(rt.state.look.name, "paper", "the theme drawn stays");
    assert_eq!(fill_of(&rt, "writing-pane"), paper);
    // Down passes over Paper and Sepia.
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.panels[0].active_id(), Some("ink"));
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.panels[0].active_id(), Some("fjord"));
    // A press on a dimmed row does nothing.
    click(&mut rt, "row-themes-sepia");
    assert_eq!((rt.state.look.name.as_str(), rt.state.panels.len()), ("fjord", 1));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_writers_own_theme_is_noted_custom() {
    let dir = config("themes-custom");
    std::fs::create_dir_all(dir.join("themes")).unwrap();
    std::fs::write(dir.join("themes/mine.json"), r##"{ "theme": { "background": "#ffffff", "text": "#111111" } }"##).unwrap();
    let mut rt = themed(&dir);
    cmd(&mut rt, Key::Command('t'));
    let note = rt.state.panels[0].rows.iter().find_map(|r| match r {
        Row::Item(i) if i.id == "mine" => i.note.clone(),
        _ => None,
    });
    assert_eq!(note.as_deref(), Some(rubric_app::draft::CUSTOM));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_theme_list_wraps() {
    let dir = config("themes-wrap");
    let mut rt = themed(&dir);
    cmd(&mut rt, Key::Command('t'));
    press(&mut rt, Key::Up);
    press(&mut rt, Key::Up);
    let last = rt.state.look.themes.iter().rev().find(|e| e.has(Mode::Light)).unwrap().name.clone();
    assert_eq!(rt.state.panels[0].active_id(), Some(last.as_str()), "Up on the first row goes to the last");
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.panels[0].active_id(), Some("mode"), "Down on the last goes to the first");
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
        Row::Field { id: "words".into(), label: None, placeholder: "words".into(), value: String::new() },
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

#[test]
fn a_still_pointer_under_the_theme_list_chooses_nothing() {
    let dir = config("themes-still");
    let mut rt = themed(&dir);
    cmd(&mut rt, Key::Command(','));
    for _ in 0..20 {
        rt.frame(1.0 / 60.0);
    }
    let (x, y) = rt.find(&rubric_app::look::row_key("themes", "aura")).expect("drawn");
    press(&mut rt, Key::Escape);
    rt.pointer_move(x, y);
    rt.frame(1.0 / 60.0);
    cmd(&mut rt, Key::Command(','));
    for _ in 0..20 {
        rt.frame(1.0 / 60.0);
    }
    assert_eq!(rt.state.look.name, "paper", "opened under a resting pointer");
    assert_eq!(rt.state.panels[0].active_id(), Some("paper"));
    // Up past the first row wraps to the last, scrolling the list under the pointer.
    for _ in 0..2 {
        press(&mut rt, Key::Up);
        rt.frame(1.0 / 60.0);
    }
    for _ in 0..20 {
        rt.frame(1.0 / 60.0);
    }
    let last = rt.state.look.themes.iter().rev().find(|e| e.has(Mode::Light)).unwrap().name.clone();
    assert_eq!(rt.state.panels[0].active_id(), Some(last.as_str()), "scrolled past a resting pointer");
    assert_eq!(rt.state.look.name, last);
    // The pointer moving onto a row does take it.
    let near = rt.state.look.themes.iter().rev().filter(|e| e.has(Mode::Light)).nth(1).unwrap().name.clone();
    let (x, y) = rt.find(&rubric_app::look::row_key("themes", &near)).expect("drawn");
    rt.pointer_move(x, y);
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.look.name, near);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_mode_in_the_theme_list_redraws_at_once_is_kept_with_return_and_restored_by_esc() {
    let dir = config("themes-mode");
    let mut rt = themed(&dir);
    let light = fill_of(&rt, "writing-pane");
    cmd(&mut rt, Key::Command(','));
    press(&mut rt, Key::Up);
    assert_eq!(rt.state.panels[0].active_id(), Some(rubric_app::look::MODE), "the mode is the list's first row");
    press(&mut rt, Key::Right);
    assert_eq!(rt.state.look.mode, Mode::Dark);
    assert_eq!(fill_of(&rt, "writing-pane"), Look::load(None, Some("paper".into()), Some(Mode::Dark)).palette.pane);
    press(&mut rt, Key::Escape);
    assert_eq!((rt.state.look.name.as_str(), rt.state.look.mode), ("paper", Mode::Light));
    assert_eq!(fill_of(&rt, "writing-pane"), light);
    assert!(!dir.join("app.json").exists(), "nothing written");

    cmd(&mut rt, Key::Command(','));
    press(&mut rt, Key::Up);
    press(&mut rt, Key::Right);
    press(&mut rt, Key::Down);
    assert_eq!((rt.state.look.name.as_str(), rt.state.look.mode), ("ink", Mode::Dark));
    press(&mut rt, Key::Enter);
    let next = Look::load(Some(dir.clone()), None, None);
    assert_eq!((next.name.as_str(), next.mode), ("ink", Mode::Dark), "a new start reads both");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_key_that_opens_the_theme_list_closes_it() {
    let dir = config("themes-toggle");
    let mut rt = themed(&dir);
    cmd(&mut rt, Key::Command(','));
    press(&mut rt, Key::Down);
    cmd(&mut rt, Key::Command(','));
    assert!(rt.state.panels.is_empty());
    assert_eq!(rt.state.look.name, "paper", "the theme before comes back");
    std::fs::remove_dir_all(&dir).unwrap();
}

// A placed part's menu (task 5).

fn sent_to(sent: &std::sync::mpsc::Receiver<Value>, method: &str) -> Vec<Value> {
    std::iter::from_fn(|| sent.try_recv().ok()).filter(|m| m["method"] == method).collect()
}

const QUOTE: &str = "before\n::: quote\nWords inside.\n:::\nafter";

fn quote(kind: &str) -> Value {
    json!({ "name": "quote", "kind": kind, "uses": { "blocks": 3, "pages": 2 }, "close": 3,
        "settings": [
            { "name": "size", "type": "choice", "values": ["normal", "large"], "default": "normal" },
            { "name": "cite", "type": "text" } ],
        "look": [ { "name": "shadow", "type": "choice", "values": ["none", "soft", "deep"], "default": "none" } ] })
}

/// Tab on the part's line, the server's part and its drafts answered: its menu is open.
fn part_menu(text: &str, line: u32, part: Value, view: Value) -> (Runtime<State>, std::sync::mpsc::Receiver<Value>) {
    let (mut rt, sent) = on_line(text, line);
    press(&mut rt, Key::Tab);
    let all: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    let asked = all.iter().find(|m| m["method"] == "rubric/part").expect("Tab asks what the part is");
    let look = all.iter().find(|m| m["method"] == "rubric/draft").expect("and its drafts together");
    answer(&mut rt, asked, part);
    answer(&mut rt, look, view);
    assert_eq!(top(&rt).as_deref(), Some("part"));
    (rt, sent)
}

#[test]
fn a_part_menu_segment_sends_set_with_its_name_and_value_and_nothing_else() {
    let (mut rt, sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
    assert_eq!(rows(&rt)[0], "set:size");
    press(&mut rt, Key::Right);
    let all: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    assert_eq!(all.len(), 1, "{all:?}");
    assert_eq!(all[0]["method"], "rubric/part");
    assert_eq!(all[0]["params"]["set"], json!({ "name": "size", "value": "large" }));
    assert_eq!(all[0]["params"]["line"], 1);
    // The server's line goes in place, and the menu stays.
    answer(&mut rt, &all[0], json!({ "replace": "::: quote size=large" }));
    assert_eq!(rt.state.edit.text, "before\n::: quote size=large\nWords inside.\n:::\nafter");
    assert_eq!(top(&rt).as_deref(), Some("part"));
    let change = sent_to(&sent, "textDocument/didChange");
    assert_eq!(change.len(), 1, "the server hears of it");
    // A second change goes from the line as it reads now.
    press(&mut rt, Key::Left);
    let next = sent_to(&sent, "rubric/part");
    assert_eq!(next[0]["params"]["set"]["value"], "normal");
}

#[test]
fn crossing_every_row_of_a_parts_menu_moves_no_focus() {
    let (mut rt, _sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
    let n = rt.state.panels[0].rows.iter().filter(|r| r.takes_focus()).count();
    let shift_tab = KeyEvent { key: Key::Tab, mods: Mods { shift: true, ..Mods::default() } };
    let mut seen = std::collections::HashSet::new();
    for round in 0..6 {
        for _ in 0..n + 1 {
            if round % 2 == 0 { press(&mut rt, Key::Down) } else { press(&mut rt, Key::Tab) }
            seen.insert(rt.state.panels[0].active_id().unwrap().to_string());
            assert!(editor_focused(&rt) && !field_focused(&rt), "on {:?}", rt.state.panels[0].active_id());
        }
        for _ in 0..n + 1 {
            if round % 2 == 0 { press(&mut rt, Key::Up) } else { rt.key(shift_tab.clone()); rt.frame(1.0 / 60.0); }
            assert!(editor_focused(&rt) && !field_focused(&rt), "on {:?}", rt.state.panels[0].active_id());
        }
    }
    assert!(seen.contains("set:cite") && seen.contains("words"), "both fields were crossed: {seen:?}");
    assert_eq!(top(&rt).as_deref(), Some("part"), "Tab chose nothing");
    assert_eq!(rt.state.edit.text, QUOTE);
}

#[test]
fn typing_on_a_field_row_keeps_the_first_character_as_a_key_or_a_commit() {
    for first in ["key", "commit"] {
        let (mut rt, sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
        press(&mut rt, Key::Down);
        assert_eq!(rt.state.panels[0].active_id(), Some("set:cite"));
        if first == "key" { press(&mut rt, Key::Text("A".into())) } else { rt.ime(Ime::Commit("A".into())); rt.frame(1.0 / 60.0); }
        assert!(field_focused(&rt), "{first}: typed on, the field has the keys");
        rt.ime(Ime::Commit(". Keeper".into()));
        rt.frame(1.0 / 60.0);
        assert_eq!(rt.state.edit.text, QUOTE, "{first}: the writing is untouched");
        press(&mut rt, Key::Enter);
        let set = sent_to(&sent, "rubric/part");
        assert_eq!(set[0]["params"]["set"], json!({ "name": "cite", "value": "A. Keeper" }), "{first}");
        assert!(editor_focused(&rt), "{first}: Return gives the keys back to the writing");
        // The writing's history is as it was: undo brings back no stray text.
        press(&mut rt, Key::Escape);
        cmd(&mut rt, Key::Command('z'));
        assert_eq!(rt.state.edit.text, QUOTE, "{first}");
    }
}

fn rect_of(rt: &Runtime<State>, key: &str) -> [f32; 4] {
    rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key) && !e.exiting).unwrap_or_else(|| panic!("no {key}")).rect
}

#[test]
fn a_panel_hangs_from_the_start_of_its_line_and_stays_there_until_the_writing_scrolls() {
    let text = format!("{}::: quote\nWords inside.\n:::\n{}", "Line before.\n\n".repeat(8), "Line after.\n\n".repeat(40));
    let at = 16;
    let (mut rt, sent) = part_menu(&text, at, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
    settle(&mut rt);
    let first = rect_of(&rt, "panel-0");
    let editor = rect_of(&rt, "editor");
    assert!((first[0] - editor[0]).abs() < 1.0, "at the line's left edge: {first:?} {editor:?}");
    // A setting written puts the caret at the end of a longer line: the panel stays.
    press(&mut rt, Key::Right);
    let set = sent_to(&sent, "rubric/part");
    answer(&mut rt, &set[0], json!({ "replace": "::: quote size=large cite=\"The keeper of the lighthouse\"" }));
    settle(&mut rt);
    assert_eq!(top(&rt).as_deref(), Some("part"));
    assert_eq!(rect_of(&rt, "panel-0")[..2], first[..2], "the panel did not move");
    // The writing scrolls: the panel goes with its line.
    let pane = rect_of(&rt, "writing");
    rt.wheel(pane[0] + 4.0, pane[1] + pane[3] - 10.0, -60.0);
    settle(&mut rt);
    let moved = rect_of(&rt, "editor")[1] - editor[1];
    assert!(moved < -1.0, "the writing scrolled: {moved}");
    let now = rect_of(&rt, "panel-0");
    assert!((now[1] - (first[1] + moved)).abs() < 1.0, "the panel followed: {now:?} from {first:?} by {moved}");
}

#[test]
fn the_time_to_a_menu_names_the_menu_and_the_servers_share_once() {
    let (rt, _sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
    let said = rubric_app::state::menu_drawn(&rt.state).expect("said");
    assert!(said.contains(": part,") && said.contains("server"), "{said}");
    assert!(rubric_app::state::menu_drawn(&rt.state).is_none(), "once");
    let (rt, _sent) = with_menu(NEW, 1, json!({ "words": "a tide clock" }));
    assert!(rubric_app::state::menu_drawn(&rt.state).unwrap().contains(": draft,"));
}

#[test]
fn undo_after_a_setting_restores_the_line() {
    let (mut rt, sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
    press(&mut rt, Key::Right);
    let set = sent_to(&sent, "rubric/part");
    answer(&mut rt, &set[0], json!({ "replace": "::: quote size=large" }));
    cmd(&mut rt, Key::Command('z'));
    assert_eq!(rt.state.edit.text, QUOTE);
    assert!(rt.state.panels.is_empty(), "undo is the writing's: the menu closes");
}

#[test]
fn a_text_setting_is_typed_in_its_field_and_sent_on_return() {
    let (mut rt, sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.panels[0].active_id(), Some("set:cite"));
    rt.ime(Ime::Commit("A. Keeper".into()));
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.edit.text, QUOTE, "typed in the field, not the writing");
    press(&mut rt, Key::Enter);
    let set = sent_to(&sent, "rubric/part");
    assert_eq!(set[0]["params"]["set"], json!({ "name": "cite", "value": "A. Keeper" }));
}

#[test]
fn remove_on_a_catalog_part_keeps_the_blocks_writing() {
    let (mut rt, sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true }));
    let del = if cfg!(target_os = "macos") { Key::Backspace } else { Key::Delete };
    cmd(&mut rt, del);
    assert_eq!(rt.state.edit.text, "before\nWords inside.\nafter");
    assert!(drafts(&sent).is_empty(), "the server is asked nothing");
    cmd(&mut rt, Key::Command('z'));
    assert_eq!(rt.state.edit.text, QUOTE, "one undo");
}

#[test]
fn remove_on_an_own_part_sends_nothing_until_the_second_panels_choice() {
    let tide = "::: tide-table\n:::";
    let own = json!({ "name": "tide-table", "kind": "own", "uses": { "blocks": 3, "pages": 2 }, "close": 1, "settings": [], "look": [] });
    let (mut rt, sent) = part_menu(tide, 0, own, json!({ "words": "Tides", "of": "tide-table" }));
    let del = if cfg!(target_os = "macos") { Key::Backspace } else { Key::Delete };
    cmd(&mut rt, del.clone());
    assert_eq!(top(&rt).as_deref(), Some("remove"));
    assert!(std::iter::from_fn(|| sent.try_recv().ok()).next().is_none(), "nothing sent yet");
    assert_eq!(rows(&rt), ["keep", "unwrap", "remove-site"]);
    press(&mut rt, Key::Enter);
    assert_eq!(top(&rt).as_deref(), Some("part"), "Keep goes back");
    assert!(std::iter::from_fn(|| sent.try_recv().ok()).next().is_none());
    cmd(&mut rt, del);
    rt.update(|s, _| { s.panels[1].focus("remove-site"); });
    press(&mut rt, Key::Enter);
    let removed = drafts(&sent);
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0]["params"]["action"], "remove");
}

#[test]
fn kept_and_removed_are_said_once_the_server_has_done_it() {
    let tide = "::: tide-table\n:::";
    let own = || json!({ "name": "tide-table", "kind": "own", "uses": { "blocks": 1, "pages": 1 }, "close": 1, "settings": [], "look": [] });
    let label = |rt: &Runtime<State>| rt.state.flash.as_ref().map(|f| f.0.label.clone());
    // Add to every site, refused.
    let (mut rt, sent) = part_menu(tide, 0, own(), json!({ "words": "Tides", "of": "tide-table" }));
    rt.update(|s, _| { s.panels[0].focus("global"); });
    press(&mut rt, Key::Enter);
    let keep = drafts(&sent);
    assert_eq!(keep[0]["params"]["global"], true);
    assert_eq!(label(&rt), None, "nothing said before the answer");
    answer(&mut rt, &keep[0], json!({ "error": "no such part" }));
    assert_eq!(label(&rt).as_deref(), Some("Failed"));
    // Remove from site, done.
    let (mut rt, sent) = part_menu(tide, 0, own(), json!({ "words": "Tides", "of": "tide-table" }));
    rt.update(|s, _| { s.panels[0].focus("remove-ask"); });
    press(&mut rt, Key::Enter);
    rt.update(|s, _| { s.panels[1].focus("remove-site"); });
    press(&mut rt, Key::Enter);
    let removed = drafts(&sent);
    assert_eq!(label(&rt), None);
    answer(&mut rt, &removed[0], json!({}));
    assert_eq!(label(&rt).as_deref(), Some("Removed"));
}

#[test]
fn change_writes_the_words_after_the_colon_and_drafts_a_variant() {
    let (mut rt, sent) = part_menu(QUOTE, 1, quote("catalog"), json!({ "words": "A quote", "of": "quote", "catalog": true, "drafter": "opus, low" }));
    rt.update(|s, _| { s.panels[0].focus("change"); });
    press(&mut rt, Key::Enter);
    assert_eq!(top(&rt).as_deref(), Some("change"));
    rt.ime(Ime::Commit("torn edge".into()));
    rt.frame(1.0 / 60.0);
    press(&mut rt, Key::Enter);
    assert_eq!(rt.state.edit.text.lines().nth(1), Some("::: quote : torn edge"));
    let built = drafts(&sent);
    assert_eq!(built.len(), 1);
    assert_eq!((built[0]["params"]["action"].as_str(), built[0]["params"]["variant"].as_bool()), (Some("build"), Some(true)));
    assert!(rt.state.panels.is_empty());
}

// Insert part… and a line of words (task 6).

fn poll(rt: &mut Runtime<State>) {
    rt.poll = Some(rubric_app::insert::poll);
}

/// Tab on the empty line 1, then Insert part…, its list answered with `parts`.
fn insert_list(parts: Value) -> (Runtime<State>, std::sync::mpsc::Receiver<Value>) {
    let (mut rt, sent) = on_line("a\n\nb", 1);
    poll(&mut rt);
    press(&mut rt, Key::Tab);
    assert_eq!(top(&rt).as_deref(), Some("insert-menu"));
    press(&mut rt, Key::Enter);
    assert_eq!(top(&rt).as_deref(), Some("insert"));
    let asked = sent_to(&sent, "rubric/parts");
    assert_eq!(asked.len(), 1);
    assert!(asked[0]["params"].get("words").is_none(), "no words: the whole catalog");
    answer(&mut rt, &asked[0], json!({ "parts": parts }));
    (rt, sent)
}

fn catalog() -> Value {
    json!([{ "name": "steps", "description": "Steps", "group": "Lists and steps" }, { "name": "quote", "description": "A quote", "group": "Writing" },
        { "name": "divider", "description": "A rule", "group": "Writing", "empty": true }])
}

#[test]
fn typing_in_insert_part_asks_once_after_the_pause_and_drops_older_answers() {
    let (mut rt, sent) = insert_list(catalog());
    for ch in ["x", "y", "z"] {
        rt.ime(Ime::Commit(ch.into()));
        rt.frame(0.05);
    }
    assert!(sent_to(&sent, "rubric/parts").is_empty(), "not one a key");
    for _ in 0..20 {
        rt.frame(0.05);
    }
    let asked = sent_to(&sent, "rubric/parts");
    assert_eq!(asked.len(), 1, "{asked:?}");
    assert_eq!(asked[0]["params"]["words"], "xyz");
    // More typed before the answer: the answer for "xyz" changes nothing.
    rt.ime(Ime::Commit("w".into()));
    rt.frame(0.05);
    for _ in 0..20 {
        rt.frame(0.05);
    }
    let newer = sent_to(&sent, "rubric/parts");
    assert_eq!(newer[0]["params"]["words"], "xyzw");
    let before = rt.state.panels.last().unwrap().rows.clone();
    answer(&mut rt, &asked[0], json!({ "parts": [{ "name": "timeline", "description": "x" }] }));
    assert_eq!(rt.state.panels.last().unwrap().rows, before);
    answer(&mut rt, &newer[0], json!({ "parts": [{ "name": "steps", "description": "Steps" }] }));
    assert!(rows(&rt).contains(&"part:steps".to_string()));
    assert_eq!(rt.state.field.text, "xyzw", "the field keeps what was typed");
}

#[test]
fn insert_part_finds_by_name_and_description_at_once_and_asks_server_only_when_empty() {
    let parts = json!([
        { "name": "tide-table", "description": "A chart of tides.", "own": true },
        { "name": "callout", "description": "A short note, such as a tip or a warning.", "group": "Writing" },
        { "name": "quote", "description": "Words as said.", "group": "Writing" },
        { "name": "sidenote", "description": "A warning beside the quote.", "group": "Writing" },
        { "name": "steps", "description": "Numbered points.", "group": "Lists and steps" }
    ]);
    let (mut rt, sent) = insert_list(parts);
    // "quo" lists quote before sidenote (name beats description) in the same frame, with no request.
    for ch in ["q", "u", "o"] {
        rt.ime(Ime::Commit(ch.into()));
        rt.frame(1.0 / 60.0);
    }
    assert_eq!(rows(&rt), ["find", "part:quote", "part:sidenote", "draft"]);
    for _ in 0..20 {
        rt.frame(0.05);
    }
    assert!(sent_to(&sent, "rubric/parts").is_empty(), "matched locally: nothing asked");

    // Emptying the field brings the groups back at once, with no request.
    for _ in 0..3 {
        press(&mut rt, Key::Backspace);
    }
    assert_eq!(rows(&rt), ["find", "group:Custom", "group:Writing", "group:Lists and steps", "draft"]);
    for _ in 0..20 {
        rt.frame(0.05);
    }
    assert!(sent_to(&sent, "rubric/parts").is_empty());

    // A description word finds callout and sidenote at once.
    rt.ime(Ime::Commit("warning".into()));
    rt.frame(1.0 / 60.0);
    assert_eq!(rows(&rt), ["find", "part:callout", "part:sidenote", "draft"]);
    assert!(sent_to(&sent, "rubric/parts").is_empty());

    // Words that find nothing clear the list and ask the server after the pause.
    rt.ime(Ime::Commit(" of storms".into()));
    rt.frame(0.05);
    assert_eq!(rows(&rt), ["find", "draft"]);
    assert!(sent_to(&sent, "rubric/parts").is_empty());
    for _ in 0..20 {
        rt.frame(0.05);
    }
    let asked = sent_to(&sent, "rubric/parts");
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0]["params"]["words"], "warning of storms");
    answer(&mut rt, &asked[0], json!({ "parts": [{ "name": "callout", "description": "A short note." }] }));
    assert_eq!(rows(&rt), ["find", "part:callout", "draft"]);
}

#[test]
fn return_in_insert_part_field_takes_the_first_found_part() {
    let (mut rt, sent) = insert_list(catalog());
    for ch in ["q", "u", "o"] {
        rt.ime(Ime::Commit(ch.into()));
        rt.frame(1.0 / 60.0);
    }
    assert_eq!(rows(&rt), ["find", "part:quote", "draft"]);
    press(&mut rt, Key::Enter);
    assert_eq!(rt.state.edit.text, "a\n::: quote\n:::\nb");
    assert!(rt.state.panels.is_empty());
    assert!(sent_to(&sent, "rubric/parts").is_empty());
}

#[test]
fn a_group_opens_its_parts_beside_and_moving_there_draws_them() {
    let (mut rt, sent) = insert_list(catalog());
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    assert_eq!(rt.state.panels[0].active_id(), Some("group:Writing"));
    let _ = peeks(&sent);
    press(&mut rt, Key::Right);
    assert_eq!((top(&rt).as_deref(), rt.state.panels.len()), (Some("insert-group"), 2), "beside the list");
    assert_eq!(rows(&rt), ["part:quote", "part:divider"]);
    assert_eq!(peeks(&sent).last(), Some(&json!("quote")), "the part with the focus is drawn");
    press(&mut rt, Key::Down);
    assert_eq!(peeks(&sent), [json!("divider")]);
    press(&mut rt, Key::Escape);
    assert_eq!(top(&rt).as_deref(), Some("insert"));
    assert_eq!(peeks(&sent), [Value::Null]);
    press(&mut rt, Key::Escape);
    assert!(rt.state.panels.is_empty());
    assert_eq!(rt.state.edit.text, "a\n\nb");
}

#[test]
fn return_on_a_groups_part_writes_it_as_one_undo() {
    let (mut rt, _sent) = insert_list(catalog());
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    assert_eq!(top(&rt).as_deref(), Some("insert-group"), "Return opens the group too");
    press(&mut rt, Key::Enter);
    assert_eq!(rt.state.edit.text, "a\n::: quote\n:::\nb");
    assert!(rt.state.panels.is_empty());
    cmd(&mut rt, Key::Command('z'));
    assert_eq!(rt.state.edit.text, "a\n\nb");
}

#[test]
fn a_long_list_keeps_its_field_in_place_while_its_rows_scroll() {
    let many: Vec<Value> = (0..40).map(|i| json!({ "name": format!("part-{i}"), "description": "x" })).collect();
    let (mut rt, sent) = insert_list(catalog());
    rt.ime(Ime::Commit("z".into()));
    for _ in 0..20 {
        rt.frame(0.05);
    }
    let asked = sent_to(&sent, "rubric/parts");
    answer(&mut rt, &asked[0], json!({ "parts": many }));
    settle(&mut rt);
    let rect = |rt: &Runtime<State>, key: &str| rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).unwrap_or_else(|| panic!("no {key}")).rect;
    let panel = rect(&rt, "panel-0");
    assert!(panel[3] <= rubric_app::panel::FIELD + rubric_app::panel::SEP + 12.0 * rubric_app::panel::ITEM + 12.0, "at most twelve rows: {panel:?}");
    let field = rect(&rt, "row-insert-find");
    for _ in 0..30 {
        press(&mut rt, Key::Down);
    }
    settle(&mut rt);
    assert_eq!(rt.state.panels[0].active_id(), Some("part:part-29"));
    assert_eq!(rect(&rt, "row-insert-find"), field, "the field stays put");
    let row = rect(&rt, "row-insert-part:part-29");
    assert!(row[1] >= panel[1] && row[1] + row[3] <= panel[1] + panel[3] + 0.5, "the row is scrolled into view: {row:?} in {panel:?}");
}

#[test]
fn draft_new_part_in_insert_part_writes_the_new_line_and_drafts() {
    let (mut rt, sent) = insert_list(catalog());
    rt.ime(Ime::Commit("a tide clock".into()));
    rt.frame(1.0 / 60.0);
    cmd(&mut rt, Key::Enter);
    assert_eq!(rt.state.edit.text, "a\n::: new: a tide clock\n:::\nb");
    let built = drafts(&sent);
    assert_eq!((built[0]["params"]["action"].as_str(), built[0]["params"]["line"].as_u64()), (Some("build"), Some(1)));
}

#[test]
fn a_line_of_words_that_is_no_part_offers_the_best_part_and_a_new_one() {
    let (mut rt, sent) = on_line("::: three steps\n:::", 0);
    rt.update(|s, _| s.edit.set_caret(3));
    press(&mut rt, Key::Tab);
    let asked = sent_to(&sent, "rubric/part");
    answer(&mut rt, &asked[0], Value::Null);
    let parts = sent_to(&sent, "rubric/parts");
    assert_eq!(parts[0]["params"]["words"], "three steps");
    answer(&mut rt, &parts[0], json!({ "parts": [{ "name": "steps", "description": "Steps" }, { "name": "timeline", "description": "x" }] }));
    assert_eq!(rows(&rt), ["part:steps", "similar", "draft"]);
    press(&mut rt, Key::Enter);
    assert_eq!(rt.state.edit.text, "::: steps\n:::");
}

/// Right-click on the middle of visual line `line` of `"editor"` (using `Runtime::text_line`).
fn right_click_line(rt: &mut Runtime<State>, line: u32) -> [f32; 4] {
    let start = rubric_app::position::line_range(&rt.state.edit.text, line).start;
    let box_ = rt.text_line("editor", start).expect("line laid out").rect;
    let (x, y) = (box_[0] + 10.0, box_[1] + box_[3] * 0.5);
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rt.frame(1.0 / 60.0);
    rt.frame(1.0 / 60.0);
    box_
}

#[test]
fn right_click_on_a_part_line_moves_the_caret_sends_part_and_hangs_from_that_line() {
    let text = "first line\nsecond line\nthird line\n::: quote\nBody.\n:::";
    let (mut rt, sent) = on_line(text, 0);
    let box_ = right_click_line(&mut rt, 3);
    assert_eq!(rubric_app::position::line_char(&rt.state.edit.text, rt.state.edit.focus).0, 3);
    let all: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    let asked = all.iter().find(|m| m["method"] == "rubric/part").expect("rubric/part");
    let draft_asked = all.iter().find(|m| m["method"] == "rubric/draft").expect("rubric/draft");
    assert_eq!(asked["params"]["line"], 3);
    assert_eq!(draft_asked["params"]["line"], 3);
    answer(&mut rt, asked, json!({ "name": "quote", "kind": "catalog", "uses": { "blocks": 1, "pages": 1 }, "close": 5, "settings": [], "look": [] }));
    answer(&mut rt, draft_asked, json!({ "words": "quote", "of": "quote", "catalog": true }));
    settle(&mut rt);
    let panel = rect_of(&rt, "panel-0");
    assert!((panel[0] - box_[0]).abs() < 1.5, "panel x {} != line x {}", panel[0], box_[0]);
    assert!((panel[1] - (box_[1] + box_[3] + rubric_app::panel::GAP)).abs() < 1.5, "panel y {} != under line {}", panel[1], box_[1] + box_[3]);
}

#[test]
fn right_click_on_a_new_line_opens_the_draft_menu_at_that_line() {
    let text = "first\nsecond\n::: new: a tide clock\n:::";
    let (mut rt, sent) = on_line(text, 0);
    let box_ = right_click_line(&mut rt, 2);
    assert_eq!(rubric_app::position::line_char(&rt.state.edit.text, rt.state.edit.focus).0, 2);
    let asked = sent_to(&sent, "rubric/draft");
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0]["params"]["line"], 2);
    answer(&mut rt, &asked[0], json!({ "words": "a tide clock" }));
    settle(&mut rt);
    assert_eq!(top(&rt).as_deref(), Some("draft"));
    assert_eq!(rows(&rt), ["build"]);
    let panel = rect_of(&rt, "panel-0");
    assert!((panel[1] - (box_[1] + box_[3] + rubric_app::panel::GAP)).abs() < 1.5, "panel y {} != under line {}", panel[1], box_[1] + box_[3]);
}

#[test]
fn right_click_on_an_empty_line_opens_insert_menu_at_that_line() {
    let text = "first\nsecond\nthird\n\nfourth";
    let (mut rt, sent) = on_line(text, 0);
    let line0 = rt.text_line("editor", 0).unwrap().rect;
    let box_ = right_click_line(&mut rt, 3);
    assert!(box_[1] > line0[1] + 40.0);
    assert_eq!(rubric_app::position::line_char(&rt.state.edit.text, rt.state.edit.focus).0, 3);
    assert_eq!(top(&rt).as_deref(), Some("insert-menu"));
    let all_ids: Vec<&str> = rt.state.panels[0].rows.iter().filter_map(|r| r.id()).collect();
    assert_eq!(all_ids, ["insert", "new", "cut", "copy", "paste"]);
    assert!(sent_to(&sent, "rubric/part").is_empty());
    assert!(sent_to(&sent, "rubric/draft").is_empty());
    settle(&mut rt);
    let panel = rect_of(&rt, "panel-0");
    assert!((panel[0] - box_[0]).abs() < 1.5, "panel x {} != line x {}", panel[0], box_[0]);
    assert!((panel[1] - (box_[1] + box_[3] + rubric_app::panel::GAP)).abs() < 1.5, "panel y {} != under line {} (line0 was {})", panel[1], box_[1] + box_[3], line0[1]);
}

#[test]
fn right_click_on_writing_opens_cut_copy_paste_at_that_line_and_sends_nothing() {
    let text = "first line\nsecond line\nthird line\nfourth line";
    let (mut rt, sent) = on_line(text, 0);
    let box_ = right_click_line(&mut rt, 3);
    assert_eq!(rubric_app::position::line_char(&rt.state.edit.text, rt.state.edit.focus).0, 3);
    assert_eq!(top(&rt).as_deref(), Some("insert-menu"));
    let all_ids: Vec<&str> = rt.state.panels[0].rows.iter().filter_map(|r| r.id()).collect();
    assert_eq!(all_ids, ["cut", "copy", "paste"]);
    // Cut and Copy are dimmed when nothing is selected; Paste takes focus.
    assert_eq!(rows(&rt), ["paste"]);
    assert!(sent_to(&sent, "rubric/part").is_empty());
    assert!(sent_to(&sent, "rubric/draft").is_empty());
    assert!(sent_to(&sent, "rubric/parts").is_empty());
    settle(&mut rt);
    let panel = rect_of(&rt, "panel-0");
    assert!((panel[1] - (box_[1] + box_[3] + rubric_app::panel::GAP)).abs() < 1.5, "panel y {} != under line {}", panel[1], box_[1] + box_[3]);
}

#[test]
fn right_click_with_a_pick_showing_keeps_the_text_and_opens_the_menu() {
    let (mut rt, sent) = with_ghost("a\n::: a quote\n:::", 1, json!({ "line": 1, "text": "::: quote" }));
    assert!(rt.find("ghost").is_some());
    right_click_line(&mut rt, 1);
    assert_eq!(rt.state.edit.text, "a\n::: a quote\n:::", "right-click must not accept the pick");
    let asked = sent_to(&sent, "rubric/part");
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0]["params"]["line"], 1);
    answer(&mut rt, &asked[0], Value::Null);
    let parts = sent_to(&sent, "rubric/parts");
    assert_eq!(parts[0]["params"]["words"], "a quote");
    answer(&mut rt, &parts[0], json!({ "parts": [{ "name": "quote", "description": "Quote" }] }));
    assert_eq!(top(&rt).as_deref(), Some("words-menu"));
    assert_eq!(rt.state.edit.text, "a\n::: a quote\n:::");
}

#[test]
fn right_click_inside_a_selection_keeps_it_and_enables_copy() {
    let text = "Hello world here\nsecond line";
    let mut rt = runtime(text, 0);
    rt.update(|s, _| {
        s.edit.set_selection(0, 11);
        s.last_range = (0, 11);
    });
    rt.frame(1.0 / 60.0);
    let box_ = rt.text_line("editor", 0).unwrap().rect;
    // Click near the middle of "Hello world" (inside bytes 0..11).
    let (x, y) = (box_[0] + 24.0, box_[1] + box_[3] * 0.5);
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rt.frame(1.0 / 60.0);
    rt.frame(1.0 / 60.0);
    assert_eq!(rt.state.edit.range(), (0, 11), "selection stays");
    assert_eq!(top(&rt).as_deref(), Some("insert-menu"));
    assert_eq!(rows(&rt), ["cut", "copy", "paste"], "Cut and Copy are not dimmed");
}

#[test]
fn right_click_with_a_panel_open_on_another_line_replaces_it_with_the_pressed_lines_panel() {
    let text = "\nsecond line\nthird line\nfourth line";
    let (mut rt, _sent) = on_line(text, 0);
    press(&mut rt, Key::Tab);
    assert_eq!(rt.state.panels.len(), 1);
    assert_eq!(rt.state.panels[0].rows.iter().filter_map(|r| r.id()).collect::<Vec<_>>(), ["insert", "new", "cut", "copy", "paste"]);
    let box_ = right_click_line(&mut rt, 3);
    assert_eq!(rt.state.panels.len(), 1);
    assert_eq!(rt.state.panels[0].rows.iter().filter_map(|r| r.id()).collect::<Vec<_>>(), ["cut", "copy", "paste"]);
    settle(&mut rt);
    let panel = rect_of(&rt, "panel-0");
    assert!((panel[1] - (box_[1] + box_[3] + rubric_app::panel::GAP)).abs() < 1.5, "panel y {} != under line 3 {}", panel[1], box_[1] + box_[3]);
}

#[test]
fn tab_on_a_change_pick_opens_the_panel_at_the_line_from_the_first_frame() {
    let text = "line zero\nline one\nline two\nline three\n::: quote cite=a : torn edge\nWords.\n:::";
    let line = 4u32;
    let end = rubric_app::position::line_range(text, line).end;
    let mut s = State::open(PathBuf::from("/nonexistent/post.md"), text.to_string());
    s.edit.set_caret(end);
    s.width = 1400.0;
    let mut rt = Runtime::with_text(s, rubric_app::view, (1400.0, 900.0), Env::new(false, 1.0), rubric_app::fonts::text_system());
    rt.frame(0.0);
    let (client, sent) = rubric_app::lsp::Client::recording();
    rt.update(|s, _| rubric_app::state::connected(s, client));
    rt.frame(1.0 / 60.0);
    let asked = std::iter::from_fn(|| sent.try_recv().ok()).find(|m| m["method"] == "textDocument/inlineCompletion").expect("asked");
    let ch = rubric_app::position::line_char(text, end).1;
    let pick = json!([{
        "insertText": " ⇒ change quote",
        "range": { "start": { "line": line, "character": ch }, "end": { "line": line, "character": ch } },
        "command": { "title": "Pin", "command": "rubric.pin", "arguments": [{ "line": line, "text": "::: quote cite=a : torn edge", "change": true }] }
    }]);
    rt.update(|s, tx| {
        rubric_app::state::incoming(s, Incoming::Response { id: asked["id"].as_i64().unwrap(), result: Ok(pick) });
        rubric_app::state::follow_up(s, tx);
    });
    rt.frame(1.0 / 60.0);
    let box_ = rt.text_line("editor", rubric_app::position::line_range(text, line).start).unwrap().rect;
    while sent.try_recv().is_ok() {}

    press(&mut rt, Key::Tab);
    let reqs: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    let part_req = reqs.iter().find(|m| m["method"] == "rubric/part").expect("rubric/part");
    let draft_req = reqs.iter().find(|m| m["method"] == "rubric/draft").expect("rubric/draft");
    let part_ans = json!({ "name": "quote", "kind": "catalog", "uses": { "blocks": 1, "pages": 1 }, "close": 6, "settings": [], "look": [] });
    rt.update(|s, tx| {
        rubric_app::state::incoming(s, Incoming::Response { id: part_req["id"].as_i64().unwrap(), result: Ok(part_ans) });
        rubric_app::state::follow_up(s, tx);
    });
    let draft_ans = json!({ "words": "quote", "of": "quote", "catalog": true, "change": { "words": "torn edge", "colon": 17 } });
    rt.update(|s, tx| {
        rubric_app::state::incoming(s, Incoming::Response { id: draft_req["id"].as_i64().unwrap(), result: Ok(draft_ans) });
        rubric_app::state::follow_up(s, tx);
    });

    // Check the very first frame the panel is drawn and every frame after while settling.
    // The insertion transition scales from 0.98 around the panel's center (~2.8 pt inset on frame 0).
    let expected_x = box_[0];
    let expected_y = box_[1] + box_[3] + rubric_app::panel::GAP;
    for f in 0..20 {
        rt.frame(1.0 / 60.0);
        let anchor = rect_of(&rt, "panel-anchor");
        assert!((anchor[0] - box_[0]).abs() < 0.5, "frame {f}: anchor x {} != line x {}", anchor[0], box_[0]);
        assert!((anchor[1] - box_[1]).abs() < 0.5, "frame {f}: anchor y {} != line y {}", anchor[1], box_[1]);
        let panel = rect_of(&rt, "panel-0");
        assert!((panel[0] - expected_x).abs() < 4.0, "frame {f}: panel x {} != line x {expected_x}", panel[0]);
        assert!((panel[1] - expected_y).abs() < 4.0, "frame {f}: panel y {} != under line {expected_y}", panel[1]);
    }
    settle(&mut rt);
    let panel = rect_of(&rt, "panel-0");
    assert!((panel[0] - expected_x).abs() < 0.5, "settled panel x {} != line x {expected_x}", panel[0]);
    assert!((panel[1] - expected_y).abs() < 0.5, "settled panel y {} != under line {expected_y}", panel[1]);
    assert!(field_focused(&rt), "Change… field has the keys");
}

#[test]
fn tab_on_a_part_sends_both_requests_together_and_opens_whichever_answers_first() {
    for draft_first in [false, true] {
        let (mut rt, sent) = on_line(QUOTE, 1);
        press(&mut rt, Key::Tab);
        let reqs: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
        let part_req = reqs.iter().find(|m| m["method"] == "rubric/part").expect("rubric/part sent");
        let draft_req = reqs.iter().find(|m| m["method"] == "rubric/draft").expect("rubric/draft sent");
        assert!(draft_req["params"].get("action").is_none());
        let part_ans = quote("catalog");
        let draft_ans = json!({ "words": "A quote", "of": "quote", "catalog": true });
        if draft_first {
            answer(&mut rt, draft_req, draft_ans);
            assert!(rt.state.panels.is_empty(), "waits for rubric/part");
            answer(&mut rt, part_req, part_ans);
        } else {
            answer(&mut rt, part_req, part_ans);
            assert!(rt.state.panels.is_empty(), "waits for rubric/draft");
            answer(&mut rt, draft_req, draft_ans);
        }
        assert_eq!(top(&rt).as_deref(), Some("part"), "draft_first={draft_first}");
    }
}

#[test]
fn no_part_and_a_draft_answer_opens_the_words_menu_once() {
    for draft_first in [false, true] {
        let (mut rt, sent) = on_line("::: three steps\n:::", 0);
        rt.update(|s, _| s.edit.set_caret(3));
        press(&mut rt, Key::Tab);
        let reqs: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
        let part_req = reqs.iter().find(|m| m["method"] == "rubric/part").expect("rubric/part");
        let draft_req = reqs.iter().find(|m| m["method"] == "rubric/draft").expect("rubric/draft");
        if draft_first {
            answer(&mut rt, draft_req, Value::Null);
            assert!(rt.state.panels.is_empty());
            assert!(sent_to(&sent, "rubric/parts").is_empty());
            answer(&mut rt, part_req, Value::Null);
        } else {
            answer(&mut rt, part_req, Value::Null);
            answer(&mut rt, draft_req, Value::Null);
        }
        let parts = sent_to(&sent, "rubric/parts");
        assert_eq!(parts.len(), 1, "rubric/parts asked once (draft_first={draft_first})");
        answer(&mut rt, &parts[0], json!({ "parts": [{ "name": "steps", "description": "Steps" }] }));
        assert_eq!(top(&rt).as_deref(), Some("words-menu"));
        assert_eq!(rt.state.panels.len(), 1);
    }
}

#[test]
fn text_changed_between_the_two_answers_opens_nothing() {
    let (mut rt, sent) = on_line(QUOTE, 1);
    press(&mut rt, Key::Tab);
    let reqs: Vec<Value> = std::iter::from_fn(|| sent.try_recv().ok()).collect();
    let part_req = reqs.iter().find(|m| m["method"] == "rubric/part").expect("rubric/part");
    let draft_req = reqs.iter().find(|m| m["method"] == "rubric/draft").expect("rubric/draft");
    answer(&mut rt, part_req, quote("catalog"));
    assert!(rt.state.panels.is_empty());
    // Text changes on that line before the second answer arrives.
    rt.ime(Ime::Commit("x".into()));
    rt.frame(1.0 / 60.0);
    answer(&mut rt, draft_req, json!({ "words": "A quote", "of": "quote", "catalog": true }));
    assert!(rt.state.panels.is_empty(), "changed line opens nothing");
}

fn diag(uri: &str, list: Value) -> Incoming {
    Incoming::Notification { method: "textDocument/publishDiagnostics".into(), params: json!({ "uri": uri, "diagnostics": list }) }
}

fn note(code: &str, line: u32, data: Value) -> Value {
    json!({ "source": "rubric", "code": code, "range": { "start": { "line": line, "character": 0 }, "end": { "line": line, "character": 10 } }, "message": "m", "data": data })
}

/// Checks that at least one painted rect instance sits inside `edge_rect` with `want` color.
fn has_bar_color(rt: &Runtime<State>, edge_rect: [f32; 4], want: rune::Color) -> bool {
    let eps = 0.02;
    let srgb = rt.srgb_blend();
    let enc = |v: f32| if srgb { if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 } } else { v };
    let target = [enc(want.r) * want.a, enc(want.g) * want.a, enc(want.b) * want.a];
    let scale = rt.window_scale();
    let [ex, ey, ew, eh] = edge_rect.map(|v| v * scale);
    rt.instances.iter().any(|inst| {
        let r = inst.rect;
        let inside = r[0] >= ex - 1.5 && r[0] + r[2] <= ex + ew + 1.5 && r[1] >= ey - 1.5 && r[1] + r[3] <= ey + eh + 1.5;
        let c = inst.fill;
        let same = (c[0] - target[0]).abs() < eps && (c[1] - target[1]).abs() < eps && (c[2] - target[2]).abs() < eps;
        inside && same
    })
}

#[test]
fn a_new_line_has_its_edge_and_label_for_every_state_and_no_other_line_does() {
    let text = "plain line\n::: new: a tide clock\n:::\nanother line";
    let mut rt = runtime(text, 0);
    // Layout runs on frame 0; editor_laid_out measures draft line on frame 1; drawn on frame 2.
    rt.frame(1.0 / 60.0);
    rt.frame(1.0 / 60.0);
    let p = rt.state.look.palette;
    let ed = rect_of(&rt, "editor");
    let line_box = rt.text_line("editor", rubric_app::position::line_range(text, 1).start).unwrap().rect;
    let edge = rect_of(&rt, "draft-edge-1");
    assert!(rt.find("draft-edge-0").is_none() && rt.find("draft-edge-2").is_none() && rt.find("draft-edge-3").is_none(), "no other line has a bar");
    assert!(edge[0] + edge[2] < ed[0] - 10.0, "bar sits left of the writing, never under the first letter: {edge:?} vs {ed:?}");
    assert!(edge[1] >= line_box[1] && edge[1] + edge[3] <= line_box[1] + line_box[3] + 0.5, "bar sits over line 1: {edge:?} vs {line_box:?}");
    assert!(has_bar_color(&rt, edge, p.ink3), "not started bar is ink3");
    let label = rect_of(&rt, "draft-label-1");
    let pane = rt.state.pane;
    assert!((label[1] - line_box[1]).abs() < 1.0, "label at line y: {label:?} vs {line_box:?}");
    assert!(label[0] >= pane[0] && label[0] + label[2] <= pane[0] + pane[2] + 0.5, "label inside writing pane: {label:?} in {pane:?}");

    let uri = rt.state.uri.clone();
    // Drafting: accent color.
    tell(&mut rt, diag(&uri, json!([note("drafting", 1, json!({ "status": "drafting", "started": 0 }))])));
    settle(&mut rt);
    assert!(has_bar_color(&rt, rect_of(&rt, "draft-edge-1"), p.accent), "drafting bar is accent");
    assert!(rt.find("draft-label-1").is_some());

    // Ready: accent color, and stays completely idle once settled.
    tell(&mut rt, diag(&uri, json!([note("draft-ready", 1, json!({ "status": "ready", "name": "tide-clock", "settings": [] }))])));
    let mut frames = 0;
    while frames < 240 && rt.frame(1.0 / 60.0) {
        frames += 1;
    }
    assert!(frames < 240, "ready line settled without looping forever (frames={frames})");
    assert!(has_bar_color(&rt, rect_of(&rt, "draft-edge-1"), p.accent), "ready bar is accent");
    assert!(rt.find("draft-label-1").is_some());
    assert!(!rt.frame(1.0 / 60.0), "ready line asks for no frame while untouched");
    // No app-scheduled wake (note: focused text_input keeps its own caret blink timer if any).
    let before_boxes = rt.state.draft_boxes_for;
    assert!(!rt.frame(1.0 / 60.0), "still idle on the next frame");
    assert_eq!(rt.state.draft_boxes_for, before_boxes);

    // Failed: fail color.
    tell(&mut rt, diag(&uri, json!([note("draft-failed", 1, json!({ "status": "failed", "message": "oops" }))])));
    settle(&mut rt);
    assert!(has_bar_color(&rt, rect_of(&rt, "draft-edge-1"), p.fail), "failed bar is fail");
    assert!(rt.find("draft-label-1").is_some());
}

#[test]
fn a_part_line_has_a_bar_and_label_while_its_variant_drafts_and_none_once_kept() {
    let text = "before\n::: quote : torn edge\nWords.\n:::";
    let mut rt = runtime(text, 0);
    rt.frame(1.0 / 60.0);
    assert!(rt.find("draft-edge-1").is_none() && rt.find("draft-label-1").is_none());
    let uri = rt.state.uri.clone();
    let p = rt.state.look.palette;
    tell(&mut rt, diag(&uri, json!([note("drafting", 1, json!({ "status": "drafting", "started": 0 }))])));
    rt.frame(1.0 / 60.0);
    assert!(has_bar_color(&rt, rect_of(&rt, "draft-edge-1"), p.accent));
    assert!(rt.find("draft-label-1").is_some());
    // Kept: diagnostic leaves, line becomes the variant.
    tell(&mut rt, diag(&uri, json!([])));
    rt.frame(1.0 / 60.0);
    assert!(rt.find("draft-edge-1").is_none() && rt.find("draft-label-1").is_none(), "gone once kept");
}

#[test]
fn a_draft_label_follows_scrolling_hides_offscreen_and_on_overlap_and_goes_on_cancel() {
    let text = format!("{}::: new: a tide clock\n:::\n{}", "Line before.\n\n".repeat(4), "Line after.\n\n".repeat(30));
    let at = 8u32;
    let (mut rt, sent) = on_line(&text, at);
    rt.frame(1.0 / 60.0);
    rt.frame(1.0 / 60.0);
    let before_ed = rect_of(&rt, "editor");
    let before_label = rect_of(&rt, "draft-label-8");
    let before_edge = rect_of(&rt, "draft-edge-8");
    let pane = rect_of(&rt, "writing");
    rt.wheel(pane[0] + 4.0, pane[1] + pane[3] - 10.0, -60.0);
    settle(&mut rt);
    let delta = rect_of(&rt, "editor")[1] - before_ed[1];
    assert!(delta < -1.0, "scrolled: {delta}");
    let after_label = rect_of(&rt, "draft-label-8");
    let after_edge = rect_of(&rt, "draft-edge-8");
    assert!((after_label[1] - (before_label[1] + delta)).abs() < 1.0, "label followed scroll: {after_label:?} vs {before_label:?} + {delta}");
    assert!((after_edge[1] - (before_edge[1] + delta)).abs() < 1.0, "edge followed scroll");

    // Scroll far enough down that line 8 is out of the pane: draws nothing.
    for _ in 0..10 {
        rt.wheel(pane[0] + 4.0, pane[1] + pane[3] - 10.0, -200.0);
        settle(&mut rt);
    }
    assert!(rt.find("draft-label-8").is_none() && rt.find("draft-edge-8").is_none(), "scrolled out of pane draws nothing");

    // Scroll back up to top.
    for _ in 0..15 {
        rt.wheel(pane[0] + 4.0, pane[1] + pane[3] - 10.0, 200.0);
        settle(&mut rt);
    }
    assert!(rt.find("draft-label-8").is_some());

    // Long line reaching the label: label is hidden, edge stays.
    let long = "::: new: a very long description of a tide table that reaches all the way across the writing column to the right edge";
    rt.update(|s, tx| {
        rubric_app::part::set_line(&mut s.edit, at, long);
        rubric_app::state::changed(s);
        rubric_app::state::sync_draft_boxes(s, tx);
    });
    settle(&mut rt);
    assert!(rt.find("draft-edge-8").is_some(), "edge still shows on a long line");
    assert!(rt.find("draft-label-8").is_none(), "label is hidden when text reaches it");

    // Back to short, then canceled via server replace: both edge and label are gone.
    rt.update(|s, tx| {
        rubric_app::part::set_line(&mut s.edit, at, "::: new: a tide clock");
        rubric_app::state::changed(s);
        rubric_app::state::sync_draft_boxes(s, tx);
    });
    settle(&mut rt);
    assert!(rt.find("draft-label-8").is_some());
    press(&mut rt, Key::Tab);
    let look = drafts(&sent);
    answer(&mut rt, &look[0], json!({ "words": "a tide clock", "status": "ready", "name": "tide-clock" }));
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Down);
    press(&mut rt, Key::Enter);
    let cancel = drafts(&sent);
    assert_eq!(cancel[0]["params"]["action"], "cancel");
    answer(&mut rt, &cancel[0], json!({ "replace": "::: a tide clock" }));
    settle(&mut rt);
    assert!(rt.find("draft-edge-8").is_none() && rt.find("draft-label-8").is_none(), "gone when canceled");
}
