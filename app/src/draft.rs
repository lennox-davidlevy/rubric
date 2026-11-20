//! A `::: new: words` line: its draft's status, the menus Tab opens on it, and what their
//! choices ask of the server, as Neovim's `editors/nvim/lua/rubric/drafts.lua` does. One
//! request does everything, `rubric/draft`; with no action it answers the line's view.

use rune::{TextEdit, Tx};
use serde_json::{Value, json};

use crate::menu::{Kind, Menu, Row};
use crate::position;
use crate::state::{self, State};

/// How long a line about something that just happened stays, in ms.
pub const FLASH_MS: u64 = 4000;

/// Where a `new:` line's draft is, from the server's diagnostics.
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    None { earlier: u32 },
    Drafting { started_ms: u64, shown: Option<String> },
    Ready { name: String, settings: Vec<String> },
    Failed,
}

/// How the line and its status are colored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Dim,
    Accent,
    Warn,
}

impl Status {
    pub fn tone(&self) -> Tone {
        match self {
            Status::None { .. } => Tone::Dim,
            Status::Drafting { .. } | Status::Ready { .. } => Tone::Accent,
            Status::Failed => Tone::Warn,
        }
    }
}

/// Each `new:` line's status in a `textDocument/publishDiagnostics`: the server's four codes
/// for it, from the source "rubric", and nothing else.
pub fn statuses(params: &Value) -> Vec<(u32, Status)> {
    let Some(list) = params.get("diagnostics").and_then(Value::as_array) else { return Vec::new() };
    list.iter().filter_map(|d| {
        if d.get("source").and_then(Value::as_str) != Some("rubric") {
            return None;
        }
        let line = d.get("range")?.get("start")?.get("line")?.as_u64()? as u32;
        let data = d.get("data");
        let text = |k: &str| data.and_then(|v| v.get(k)).and_then(Value::as_str).map(str::to_string);
        let num = |k: &str| data.and_then(|v| v.get(k)).and_then(Value::as_u64);
        let status = match d.get("code")?.as_str()? {
            "new-part" => Status::None { earlier: num("earlier").unwrap_or(0) as u32 },
            "drafting" => Status::Drafting { started_ms: num("started").unwrap_or(0), shown: text("shown") },
            "draft-ready" => Status::Ready {
                name: text("name")?,
                settings: data.and_then(|v| v.get("settings")).and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|s| s.get("name")?.as_str().map(str::to_string)).collect())
                    .unwrap_or_default(),
            },
            "draft-failed" => Status::Failed,
            _ => return None,
        };
        Some((line, status))
    }).collect()
}

/// What follows `new:` on a line that opens a new part (`^\s*:::+\s*new:`, as the Lua), trimmed.
pub fn new_words(line: &str) -> Option<&str> {
    let t = line.trim_start();
    let after = t.trim_start_matches(':');
    (t.len() - after.len() >= 3).then(|| after.trim_start().strip_prefix("new:")).flatten().map(str::trim)
}

pub fn is_new_line(line: &str) -> bool {
    new_words(line).is_some()
}

/// The status in a mark and a few words.
pub fn says(status: &Status, now_ms: u64) -> (char, String) {
    match status {
        Status::None { earlier: 0 } => ('+', "Tab drafts a part".into()),
        Status::None { earlier: 1 } => ('+', "Tab: 1 earlier take, or a new draft".into()),
        Status::None { earlier } => ('+', format!("Tab: {earlier} earlier takes, or a new draft")),
        Status::Drafting { started_ms, shown } => {
            let seconds = now_ms.saturating_sub(*started_ms) / 1000;
            let still = shown.as_ref().map(|n| format!(" · {n} still shown")).unwrap_or_default();
            ('◐', format!("drafting {seconds} s{still}"))
        }
        Status::Ready { name, settings } => {
            let sets = if settings.is_empty() { String::new() } else { format!(" · settings {}", settings.join(", ")) };
            ('◆', format!("{name} drafted{sets} · Tab keep, reroll, cancel"))
        }
        Status::Failed => ('✗', "draft failed · Tab retries".into()),
    }
}

/// The fields of the server's `DraftView` this slice reads.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct View {
    pub words: String,
    /// "drafting", "ready", "failed", or none.
    pub status: Option<String>,
    pub name: Option<String>,
    pub message: Option<String>,
    /// A finished draft still drawn while another is made.
    pub shown: Option<String>,
    pub earlier: u32,
    pub near: Vec<Near>,
    pub drafter: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Near {
    pub name: String,
    pub description: String,
    pub own: bool,
}

impl View {
    pub fn parse(v: &Value) -> Option<View> {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Some(View {
            words: text("words")?,
            status: text("status"),
            name: text("name"),
            message: text("message"),
            shown: text("shown"),
            earlier: v.get("earlier").and_then(Value::as_u64).unwrap_or(0) as u32,
            near: v.get("near").and_then(Value::as_array).map(|a| a.iter().filter_map(|n| Some(Near {
                name: n.get("name")?.as_str()?.to_string(),
                description: n.get("description").and_then(Value::as_str).unwrap_or("").to_string(),
                own: n.get("own").and_then(Value::as_bool).unwrap_or(false),
            })).collect()).unwrap_or_default(),
            drafter: text("drafter"),
        })
    }

    /// The draft Keep keeps: the ready one, or one still drawn beside a newer.
    fn kept(&self) -> Option<&str> {
        if self.status.as_deref() == Some("ready") { self.name.as_deref().or(self.shown.as_deref()) } else { self.shown.as_deref() }
    }
}

/// The line's first menu, by where its draft is (`M.act`); none when no words follow `new:`.
pub fn menu_for(view: &View) -> Option<Menu> {
    if view.words.is_empty() {
        return None;
    }
    let mut rows = Vec::new();
    let similar = |rows: &mut Vec<Row>| match view.near.as_slice() {
        [] => {}
        [one] => rows.push(Row::new("near", format!("Similar: {}", one.name))),
        many => rows.push(Row::new("near", format!("Similar parts ({})", many.len()))),
    };
    let keep = |rows: &mut Vec<Row>| {
        if let Some(name) = view.kept() {
            rows.push(Row::new("keep", format!("Keep {name}")));
        }
    };
    let title = match view.status.as_deref() {
        Some("ready") => {
            keep(&mut rows);
            rows.push(Row::new("reroll", "Reroll…"));
            rows.push(Row::new("cancel", "Cancel"));
            format!("{}, in the preview", view.name.as_deref().unwrap_or("draft"))
        }
        Some("drafting") => {
            rows.push(Row::new("wait", "Wait"));
            rows.push(Row::new("stop", match &view.shown {
                Some(shown) => format!("Stop, back to {shown}"),
                None => "Stop".into(),
            }));
            keep(&mut rows);
            rows.push(Row::new("cancel", "Cancel draft"));
            "Drafting".into()
        }
        Some("failed") => {
            rows.push(Row::new("build", "Retry"));
            keep(&mut rows);
            rows.push(Row::new("cancel", "Cancel"));
            format!("Draft failed: {}", view.message.as_deref().unwrap_or("no reason given"))
        }
        _ if view.earlier > 0 => {
            similar(&mut rows);
            rows.push(Row::new("restore", format!("Earlier takes ({})", view.earlier)));
            rows.push(Row::new("build", "New draft"));
            "Drafted before".into()
        }
        _ => {
            similar(&mut rows);
            rows.push(Row::new("build", match &view.drafter {
                Some(d) => format!("Draft ({d})"),
                None => "Draft".into(),
            }));
            keep(&mut rows);
            rows.push(Row::new("cancel", "Cancel"));
            "New part".into()
        }
    };
    Some(Menu::new(Kind::New, title, rows))
}

fn keep_menu(view: &View) -> Menu {
    let name = view.kept().unwrap_or("draft");
    Menu::new(Kind::Keep, format!("Keep {name} for"), vec![Row::new("site", "This site"), Row::new("all", "Every theme")])
}

fn reroll_menu(view: &View) -> Menu {
    let name = view.name.as_deref().unwrap_or("draft");
    Menu::new(Kind::Reroll, format!("Reroll {name}"), vec![Row::new("just", "Reroll"), Row::new("notes", "Notes…")])
}

fn near_menu(view: &View) -> Menu {
    let rows = view.near.iter().map(|n| Row {
        id: n.name.clone(),
        label: n.name.clone(),
        note: Some(if n.own { format!("yours · {}", n.description) } else { n.description.clone() }),
    }).collect();
    Menu::new(Kind::Near, "Similar parts", rows)
}

/// What a request was about: the line as it read when it was sent, so its answer goes to the
/// line that reads so now, wherever typing has moved it (`find`).
#[derive(Clone, Debug, PartialEq)]
pub struct Asked {
    pub line: u32,
    pub text: String,
    pub what: What,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum What {
    /// The line's view, to open its menu.
    Look,
    /// A draft started (build, reroll, restore): answered with the view, or an error.
    Build,
    /// Keep, cancel, stop, use: answered with the line to put in place.
    Act,
}

pub fn params(action: Option<&str>, uri: &str, line: u32) -> Value {
    match action {
        Some(a) => json!({ "uri": uri, "line": line, "action": a }),
        None => json!({ "uri": uri, "line": line }),
    }
}

/// Where the line that read `text` at `line` is now: there, or the first line reading so.
pub fn find(now: &str, line: u32, text: &str) -> Option<u32> {
    if position::line_range(now, line).start < now.len() && &now[position::line_range(now, line)] == text {
        return Some(line);
    }
    now.split('\n').position(|l| l == text).map(|i| i as u32)
}

/// Puts the answer's `replace` in place of the line asked about. With `drop` (the block's
/// closer, counted from the line asked), a closer there goes too, with the block's empty
/// lines; writing in the block stays. One undo step. False when nothing changed.
pub fn replace(edit: &mut TextEdit, asked: &Asked, answer: &Value) -> bool {
    let Some(new) = answer.get("replace").and_then(Value::as_str) else { return false };
    let Some(at) = find(&edit.text, asked.line, &asked.text) else { return false };
    let line = position::line_range(&edit.text, at);
    let cut = answer.get("drop").and_then(Value::as_u64).and_then(|drop| {
        let drop = at + (drop as u32).checked_sub(asked.line)?;
        let below = position::line_range(&edit.text, drop);
        let t = edit.text[below.clone()].trim();
        let closer = t.len() >= 3 && t.bytes().all(|b| b == b':');
        if !closer || drop <= at || below.start >= edit.text.len() {
            return None;
        }
        let inside = position::line_range(&edit.text, at + 1).start;
        let from = if edit.text[inside..below.start].trim().is_empty() { inside } else { below.start };
        // The lines go with their newline; the last line takes the one before it.
        Some(if below.end < edit.text.len() { (from, below.end + 1) } else { (from - 1, below.end) })
    });
    let caret = edit.focus;
    let grown = new.len() as isize - line.len() as isize;
    let end = line.start + new.len();
    let caret = match cut {
        _ if caret <= line.end && caret >= line.start => end,
        _ if caret < line.start => caret,
        Some((from, to)) if caret >= to => (caret - (to - from)).wrapping_add_signed(grown),
        Some((from, _)) if caret > from => end,
        _ => caret.wrapping_add_signed(grown),
    };
    let new = new.to_string();
    edit.undo_group(|e| {
        if let Some((from, to)) = cut {
            e.set_selection(from, to);
            e.insert("");
        }
        e.set_selection(line.start, line.end);
        e.insert(&new);
        e.set_caret(caret);
    });
    true
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The caret's line and its text.
fn caret_line(s: &State) -> (u32, &str) {
    let line = position::line_char(&s.edit.text, s.edit.focus).0;
    (line, &s.edit.text[position::line_range(&s.edit.text, line)])
}

/// What the bottom of the writing pane says: something that just happened, or where the
/// caret's `new:` line is.
pub fn line(s: &State) -> Option<(char, String, Tone)> {
    if let Some((mark, words, tone, _)) = &s.flash {
        return Some((*mark, words.clone(), *tone));
    }
    let (line, text) = caret_line(s);
    let words = new_words(text)?;
    if words.is_empty() {
        return Some(('+', "new: needs words after it".into(), Tone::Dim));
    }
    let none = Status::None { earlier: 0 };
    let status = s.drafts.iter().find(|(l, _)| *l == line).map_or(&none, |(_, st)| st);
    let (mark, said) = says(status, s.now_ms);
    Some((mark, said, status.tone()))
}

fn flash(s: &mut State, mark: char, words: impl Into<String>, tone: Tone) {
    s.now_ms = now_ms();
    s.flash = Some((mark, words.into(), tone, s.now_ms + FLASH_MS));
    state::wake(s);
}

/// Once a second while a draft runs or a flash shows: the seconds go up, the flash goes.
/// False when nothing it shows changed.
pub fn tick(s: &mut State) -> bool {
    s.now_ms = now_ms();
    let had = s.flash.is_some();
    if s.flash.as_ref().is_some_and(|f| f.3 <= s.now_ms) {
        s.flash = None;
    }
    let drafting = s.drafts.iter().any(|(_, st)| matches!(st, Status::Drafting { .. }));
    if !drafting && s.flash.is_none() && let Some(t) = &s.ticker {
        t.rest();
    }
    drafting || had
}

/// The server's notes for a document: the `new:` lines' statuses and their colors.
pub fn diagnostics(s: &mut State, params: &Value) {
    // The server escapes fewer characters in a path than the app does: compared unescaped.
    if params.get("uri").and_then(Value::as_str).map(state::unescaped) != Some(state::unescaped(&s.uri)) {
        return;
    }
    s.drafts = statuses(params);
    s.now_ms = now_ms();
    s.spans = state::spans(s);
    if s.drafts.iter().any(|(_, st)| matches!(st, Status::Drafting { .. })) {
        state::wake(s);
    }
}

/// `rubric/drafted`: a draft finished or failed. Said for 4 s unless the caret's line is the
/// one it is for, whose own status says it.
pub fn drafted(s: &mut State, params: &Value) {
    let words = params.get("words").and_then(Value::as_str).unwrap_or("");
    if new_words(caret_line(s).1) == Some(words) {
        return;
    }
    let name = params.get("name").and_then(Value::as_str);
    match params.get("status").and_then(Value::as_str) {
        Some("ready") => flash(s, '◆', format!("{} drafted", name.unwrap_or(words)), Tone::Accent),
        Some("failed") => flash(s, '✗', format!("draft failed: {words}"), Tone::Warn),
        _ => {}
    }
}

fn send(s: &mut State, what: What, line: u32, text: String, params: Value) {
    let Some(c) = &s.client else { return };
    let id = c.request("rubric/draft", params);
    s.pending.insert(id, Asked { line, text, what });
}

/// Tab on a `new:` line: asks for its view, whose answer opens the menu. False on any other line.
pub fn tab(s: &mut State) -> bool {
    let (line, text) = caret_line(s);
    if !is_new_line(text) {
        return false;
    }
    let text = text.to_string();
    s.looked.set(Some(std::time::Instant::now()));
    let params = params(None, &s.uri, line);
    send(s, What::Look, line, text, params);
    true
}

/// An answer to a `rubric/draft` request.
pub fn answered(s: &mut State, asked: Asked, result: Result<Value, String>) {
    let answer = match result {
        Ok(v) => v,
        Err(e) => return flash(s, '✗', e, Tone::Warn),
    };
    if let Some(e) = answer.get("error").and_then(Value::as_str) {
        return flash(s, '✗', e, Tone::Warn);
    }
    match asked.what {
        What::Look => {
            // Only for the line the caret is still on, reading as it did.
            let (line, text) = caret_line(s);
            if text != asked.text || find(&s.edit.text, asked.line, &asked.text) != Some(line) {
                return;
            }
            let Some(view) = View::parse(&answer) else { return };
            s.menu = menu_for(&view);
            s.view = s.menu.is_some().then_some((view, asked));
        }
        What::Build => {}
        What::Act => {
            if replace(&mut s.edit, &asked, &answer) {
                state::changed(s);
            }
            // A kept part: its name, and what it can be set to now that it is one.
            if let Some(name) = answer.get("part").and_then(|p| p.get("name")).and_then(Value::as_str) {
                let said = match answer.get("version").and_then(Value::as_u64) {
                    Some(v) => format!("{name} kept for every theme · catalog version {v}"),
                    None => format!("{name} kept"),
                };
                flash(s, '✓', said, Tone::Accent);
            }
        }
    }
}

/// The menu goes; a part being looked at leaves the page.
pub fn close(s: &mut State) {
    let Some(menu) = s.menu.take() else { return };
    if menu.kind == Kind::Near {
        peek(s, None);
    }
    s.view = None;
}

/// The page draws `part` on the menu's line, or with none, the line as it is.
fn peek(s: &State, part: Option<&str>) {
    let (Some(c), Some((_, asked))) = (&s.client, &s.view) else { return };
    let line = find(&s.edit.text, asked.line, &asked.text).unwrap_or(asked.line);
    c.notify("rubric/peek", json!({ "uri": s.uri, "line": line, "part": part }));
}

/// The pointer is over a row: it is the active one.
pub fn active(s: &mut State, row: usize) {
    let Some(menu) = &mut s.menu else { return };
    if menu.active != row {
        menu.active = row;
        looked(s);
    }
}

/// The active row is another: in the list of similar parts, the page draws that part.
pub fn looked(s: &State) {
    let Some(menu) = s.menu.as_ref().filter(|m| m.kind == Kind::Near) else { return };
    peek(s, menu.rows.get(menu.active).map(|r| r.id.as_str()));
}

/// Esc: the list of similar parts goes back to the menu it came from; the others close.
pub fn back(s: &mut State) {
    match s.menu.as_ref().map(|m| m.kind) {
        Some(Kind::Near) => {
            peek(s, None);
            s.menu = s.view.as_ref().and_then(|(v, _)| menu_for(v));
        }
        Some(Kind::Notes) => s.menu = s.view.as_ref().map(|(v, _)| reroll_menu(v)),
        _ => close(s),
    }
}

/// A row was chosen, by key or by press.
pub fn chose(s: &mut State, id: &str, tx: &mut Tx) {
    let (Some(kind), Some((view, asked))) = (s.menu.as_ref().map(|m| m.kind), s.view.clone()) else { return };
    let Some(line) = find(&s.edit.text, asked.line, &asked.text) else { return close(s) };
    let ask = |s: &mut State, what: What, mut params: Value, extra: Value| {
        if let (Some(p), Some(e)) = (params.as_object_mut(), extra.as_object()) {
            p.extend(e.clone());
        }
        // A part chosen from the list stays on the page until the answer's line draws it.
        s.menu = None;
        s.view = None;
        send(s, what, line, asked.text.clone(), params);
    };
    let uri = s.uri.clone();
    match (kind, id) {
        (Kind::New, "build") => ask(s, What::Build, params(Some("build"), &uri, line), json!({})),
        (Kind::New, "restore") => ask(s, What::Build, params(Some("restore"), &uri, line), json!({})),
        (Kind::New, "cancel" | "stop") => ask(s, What::Act, params(Some(id), &uri, line), json!({})),
        (Kind::New, "keep") => s.menu = Some(keep_menu(&view)),
        (Kind::New, "reroll") => s.menu = Some(reroll_menu(&view)),
        (Kind::New, "near") => {
            s.menu = Some(near_menu(&view));
            looked(s);
        }
        (Kind::Keep, "site" | "all") => ask(s, What::Act, params(Some("keep"), &uri, line), json!({ "global": id == "all" })),
        (Kind::Reroll, "just") => ask(s, What::Build, params(Some("reroll"), &uri, line), json!({ "change": "" })),
        (Kind::Reroll, "notes") => {
            s.menu = Some(Menu::new(Kind::Notes, format!("Reroll {}", view.name.as_deref().unwrap_or("draft")), Vec::new()));
            s.notes = TextEdit::new("");
            s.notes.focused = true;
            tx.focus("notes", false);
        }
        (Kind::Near, part) => ask(s, What::Act, params(Some("use"), &uri, line), json!({ "part": part })),
        // Wait, and anything unknown.
        _ => close(s),
    }
}

/// Return in the notes field: a reroll with what was typed.
pub fn reroll_with_notes(s: &mut State, tx: &mut Tx) {
    let Some((_, asked)) = s.view.take() else { return };
    s.menu = None;
    tx.focus("editor", false);
    let Some(line) = find(&s.edit.text, asked.line, &asked.text) else { return };
    let mut p = params(Some("reroll"), &s.uri, line);
    p["change"] = json!(s.notes.text.trim());
    send(s, What::Build, line, asked.text, p);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(code: &str, line: u32, data: Value) -> Value {
        json!({ "source": "rubric", "code": code, "range": { "start": { "line": line, "character": 0 }, "end": { "line": line, "character": 9 } }, "message": "m", "data": data })
    }

    #[test]
    fn statuses_reads_the_four_codes_and_nothing_else() {
        let params = json!({ "uri": "file:///p.md", "diagnostics": [
            note("new-part", 1, json!({ "status": "none", "earlier": 2 })),
            note("drafting", 4, json!({ "status": "drafting", "started": 1000, "shown": "tide-clock" })),
            note("draft-ready", 7, json!({ "status": "ready", "name": "tide-clock", "settings": [{ "name": "pace", "values": ["slow"] }] })),
            note("draft-failed", 9, json!({ "status": "failed" })),
            note("unknown-part", 11, json!({})),
            { "source": "other", "code": "drafting", "range": { "start": { "line": 12, "character": 0 } }, "message": "m" },
        ] });
        assert_eq!(statuses(&params), vec![
            (1, Status::None { earlier: 2 }),
            (4, Status::Drafting { started_ms: 1000, shown: Some("tide-clock".into()) }),
            (7, Status::Ready { name: "tide-clock".into(), settings: vec!["pace".into()] }),
            (9, Status::Failed),
        ]);
    }

    #[test]
    fn new_lines_are_told_as_the_lua_pattern_tells_them() {
        for l in ["::: new: a clock", "  :::: new:", ":::new: x"] {
            assert!(is_new_line(l), "{l:?}");
        }
        for l in ["::: a new: clock", ":: new: x", "new: x"] {
            assert!(!is_new_line(l), "{l:?}");
        }
        assert_eq!(new_words(":::  new:  a tide clock "), Some("a tide clock"));
    }

    #[test]
    fn says_counts_the_seconds_and_names_the_draft() {
        let (_, drafting) = says(&Status::Drafting { started_ms: 1_000, shown: None }, 13_400);
        assert!(drafting.contains("12 s"), "{drafting}");
        let (_, ready) = says(&Status::Ready { name: "tide-clock".into(), settings: vec!["pace".into()] }, 0);
        assert!(ready.contains("tide-clock") && ready.contains("pace"), "{ready}");
        let (_, earlier) = says(&Status::None { earlier: 2 }, 0);
        assert!(earlier.contains('2'), "{earlier}");
        let marks: Vec<char> = [Status::None { earlier: 0 }, Status::Drafting { started_ms: 0, shown: None }, Status::Ready { name: "x".into(), settings: vec![] }, Status::Failed]
            .iter().map(|s| says(s, 0).0).collect();
        let mut unique = marks.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 4, "each status has its own mark: {marks:?}");
    }

    fn view(v: Value) -> View {
        View::parse(&v).unwrap()
    }

    fn ids(m: &Menu) -> Vec<&str> {
        m.rows.iter().map(|r| r.id.as_str()).collect()
    }

    #[test]
    fn the_menu_follows_where_the_draft_is() {
        assert_eq!(menu_for(&view(json!({ "words": "" }))), None);
        assert_eq!(ids(&menu_for(&view(json!({ "words": "a clock", "drafter": "the stub" }))).unwrap()), ["build", "cancel"]);
        let near = json!([{ "name": "quote", "description": "A quote", "own": false }]);
        assert_eq!(ids(&menu_for(&view(json!({ "words": "a clock", "near": near }))).unwrap()), ["near", "build", "cancel"]);
        assert_eq!(ids(&menu_for(&view(json!({ "words": "a clock", "earlier": 2 }))).unwrap()), ["restore", "build"]);
        assert_eq!(ids(&menu_for(&view(json!({ "words": "a clock", "status": "drafting" }))).unwrap()), ["wait", "stop", "cancel"]);
        assert_eq!(ids(&menu_for(&view(json!({ "words": "a clock", "status": "drafting", "shown": "clock" }))).unwrap()), ["wait", "stop", "keep", "cancel"]);
        assert_eq!(ids(&menu_for(&view(json!({ "words": "a clock", "status": "ready", "name": "clock", "takes": 3 }))).unwrap()), ["keep", "reroll", "cancel"]);
        assert_eq!(ids(&menu_for(&view(json!({ "words": "a clock", "status": "failed", "message": "no" }))).unwrap()), ["build", "cancel"]);
    }

    fn asked(line: u32, text: &str) -> Asked {
        Asked { line, text: text.into(), what: What::Act }
    }

    #[test]
    fn the_answer_goes_to_the_line_where_it_is_now() {
        let mut e = TextEdit::new("a\nb\nc\n\n::: new: a clock\ninside\n:::\nafter");
        assert!(replace(&mut e, &asked(1, "::: new: a clock"), &json!({ "replace": "::: clock" })));
        assert_eq!(e.text, "a\nb\nc\n\n::: clock\ninside\n:::\nafter");
    }

    #[test]
    fn drop_takes_the_closer_and_the_empty_lines_and_one_undo_restores_them() {
        let text = "x\n::: new: a rule\n\n:::\nafter";
        let mut e = TextEdit::new(text);
        e.set_caret(text.len());
        // Asked when the line was at 0 and its closer at 2; it is one lower now.
        assert!(replace(&mut e, &asked(0, "::: new: a rule"), &json!({ "replace": "::: rule", "drop": 2 })));
        assert_eq!(e.text, "x\n::: rule\nafter");
        assert_eq!(e.focus, e.text.len(), "the caret stays at the end of the text");
        e.undo();
        assert_eq!(e.text, text);
    }

    #[test]
    fn drop_keeps_what_is_written_in_the_block() {
        let mut e = TextEdit::new("::: new: a rule\nkept\n:::");
        assert!(replace(&mut e, &asked(0, "::: new: a rule"), &json!({ "replace": "::: rule", "drop": 2 })));
        assert_eq!(e.text, "::: rule\nkept");
    }

    #[test]
    fn nothing_changes_when_the_line_is_gone_or_the_answer_has_no_line() {
        let mut e = TextEdit::new("::: new: another\n:::");
        assert!(!replace(&mut e, &asked(0, "::: new: a rule"), &json!({ "replace": "::: rule" })));
        assert!(!replace(&mut e, &asked(0, "::: new: another"), &json!({ "part": "x" })));
        assert_eq!(e.text, "::: new: another\n:::");
    }

    #[test]
    fn the_caret_on_the_line_ends_at_its_end() {
        let mut e = TextEdit::new("::: new: a clock\n:::");
        e.set_caret(16);
        replace(&mut e, &asked(0, "::: new: a clock"), &json!({ "replace": "::: a clock" }));
        assert_eq!(e.range(), (11, 11));
    }
}
