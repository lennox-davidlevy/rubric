//! A `::: new: words` line: its draft's status, the panels Tab opens on it, and what their
//! choices ask of the server, as Neovim's `editors/nvim/lua/rubric/drafts.lua` does. One
//! request does everything, `rubric/draft`; with no action it answers the line's view. The
//! panels are the design's `menu`, `draft-running`, `draft-ready`, `takes`, `draft-failed`,
//! `new-part` and `reroll-notes` (`RubricWindow.dc.html`).

use rune::{Key, KeyEvent, TextEdit, Tx};
use serde_json::{Value, json};

use crate::panel::{Chord, Item, Panel, Row, Taken};
use crate::position;
use crate::state::{self, State};

/// How long a line about something that just happened stays, in ms.
pub const FLASH_MS: u64 = 4000;

/// The panels' ids: the line's menu, and the second panels it opens.
pub const MENU: &str = "draft";
pub const NEAR: &str = "near";
pub const TAKES: &str = "takes";
pub const DRAFTER: &str = "drafter";
pub const NOTES: &str = "notes";

/// Where a `new:` line's draft is, from the server's diagnostics.
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    None { earlier: u32 },
    Drafting { started_ms: u64, shown: Option<String> },
    Ready { name: String, settings: Vec<String> },
    Failed { message: Option<String> },
}

/// How the line and its status are colored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Dim,
    /// The text's own color: something done.
    Ink,
    Accent,
    Warn,
}

impl Status {
    pub fn tone(&self) -> Tone {
        match self {
            Status::None { .. } => Tone::Dim,
            Status::Drafting { .. } | Status::Ready { .. } => Tone::Accent,
            Status::Failed { .. } => Tone::Warn,
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
            "draft-failed" => Status::Failed { message: text("message") },
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

/// "tide-table" reads "Tide table"; words read with a capital.
pub fn readable(name: &str) -> String {
    let words = name.replace(['-', '_'], " ");
    let mut c = words.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

/// Seconds as the design writes them: "0:14".
pub fn clock(ms: u64) -> String {
    let s = ms / 1000;
    format!("{}:{:02}", s / 60, s % 60)
}

/// What the status line under the writing says: a label in the state's color, one fact, and at
/// most one action with its key.
#[derive(Clone, Debug, PartialEq)]
pub struct Said {
    pub label: String,
    pub tone: Tone,
    pub fact: String,
    pub action: Option<(String, Chord)>,
}

fn action(id: &str) -> Option<(String, Chord)> {
    let (label, key) = match id {
        "build" => ("Draft", Key::Enter),
        "stop" => ("Stop", Key::Command('.')),
        "keep" => ("Keep", Key::Enter),
        "reroll" => ("Reroll", Key::Command('r')),
        _ => return None,
    };
    Some((label.into(), Chord(key)))
}

/// What the line's status says, and the id of its action.
pub fn says(status: &Status, words: &str, now_ms: u64) -> (Said, &'static str) {
    let fact = readable(words);
    let (label, fact, id) = match status {
        Status::None { .. } => ("Not started".to_string(), fact, "build"),
        Status::Drafting { started_ms, .. } => (format!("Drafting {}", clock(now_ms.saturating_sub(*started_ms))), fact, "stop"),
        Status::Ready { .. } => ("Ready".into(), fact, "keep"),
        Status::Failed { message } => (format!("{fact} failed"), message.as_deref().map_or_else(|| "No reason given".into(), readable), "reroll"),
    };
    (Said { label, tone: status.tone(), fact, action: action(id) }, id)
}

/// The fields of the server's `DraftView` the app reads.
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
    /// The writer's default drafter, in a few words ("opus, low").
    pub drafter: Option<String>,
    /// The take on screen, from 1, of `takes` finished ones.
    pub take: Option<u32>,
    pub takes: u32,
    /// Each take, oldest first, when there are two or more.
    pub list: Vec<Take>,
    /// On a placed part's line: the part whose takes these are.
    pub of: Option<String>,
    /// The takes are of a new variant of this part.
    pub new_variant: Option<String>,
    /// The words after the line's `:`.
    pub change: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Near {
    pub name: String,
    pub description: String,
    pub own: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Take {
    /// What drafted it.
    pub by: Option<String>,
    /// What a reroll asked it to change.
    pub change: Option<String>,
}

impl View {
    pub fn parse(v: &Value) -> Option<View> {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        let num = |k: &str| v.get(k).and_then(Value::as_u64).map(|n| n as u32);
        Some(View {
            words: text("words")?,
            status: text("status"),
            name: text("name"),
            message: text("message"),
            shown: text("shown"),
            earlier: num("earlier").unwrap_or(0),
            near: v.get("near").and_then(Value::as_array).map(|a| a.iter().filter_map(|n| Some(Near {
                name: n.get("name")?.as_str()?.to_string(),
                description: n.get("description").and_then(Value::as_str).unwrap_or("").to_string(),
                own: n.get("own").and_then(Value::as_bool).unwrap_or(false),
            })).collect()).unwrap_or_default(),
            drafter: text("drafter"),
            take: num("take"),
            takes: num("takes").unwrap_or(0),
            list: v.get("list").and_then(Value::as_array).map(|a| a.iter().map(|t| Take {
                by: t.get("by").and_then(Value::as_str).map(str::to_string),
                change: t.get("change").and_then(Value::as_str).filter(|c| !c.is_empty()).map(str::to_string),
            }).collect()).unwrap_or_default(),
            of: text("of"),
            new_variant: text("newVariant"),
            change: v.get("change").and_then(|c| c.get("words")).and_then(Value::as_str).map(str::to_string),
        })
    }
}

/// A drafter for one line, chosen in the chip's panel: rides on its next build or reroll.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Choice {
    pub harness: String,
    pub model: Option<String>,
    pub effort: Option<String>,
}

impl Choice {
    /// "Opus · low".
    pub fn chip(&self) -> String {
        let who = self.model.clone().unwrap_or_else(|| tool_name(&self.harness).to_string());
        match &self.effort {
            Some(e) => format!("{} · {e}", readable(&who)),
            None => readable(&who),
        }
    }

    pub fn json(&self) -> Value {
        let mut v = json!({ "harness": self.harness });
        if let Some(m) = &self.model {
            v["model"] = json!(m);
        }
        if let Some(e) = &self.effort {
            v["effort"] = json!(e);
        }
        v
    }
}

/// The server's short name for its default drafter ("opus, low, tools") as a chip.
pub fn chip_of(short: &str) -> String {
    readable(&short.split(", ").collect::<Vec<_>>().join(" · "))
}

fn tool_name(harness: &str) -> &str {
    match harness {
        "claude" => "Claude Code",
        "opencode" => "OpenCode",
        other => other,
    }
}

/// What `rubric/drafter` answers for the drafter's panel.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Offer {
    /// The writer's default.
    pub default: Choice,
    pub models: Vec<String>,
    pub efforts: Vec<String>,
}

impl Offer {
    fn parse(v: &Value) -> Option<Offer> {
        let list = |k: &str| v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Some(Offer {
            default: Choice { harness: text("harness")?, model: text("model"), effort: text("effort") },
            models: list("models"),
            efforts: list("efforts"),
        })
    }
}

/// The line whose menu is open, what the server said of it, and what the open panels need.
#[derive(Clone, Debug, PartialEq)]
pub struct Open {
    pub view: View,
    pub asked: Asked,
    /// The take shown when the list of takes opened, for Esc to go back to.
    pub take_before: Option<u32>,
    /// `rubric/harnesses`: each tool and whether it is installed.
    pub tools: Option<Vec<(String, bool)>>,
    pub offer: Option<Offer>,
    /// On a placed part's line: the part, its settings and values.
    pub part: Option<crate::part::Part>,
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
    /// Another take on screen: answered with the view.
    Take,
    /// `rubric/harnesses` and `rubric/drafter`, for the drafter's panel.
    Tools,
    Offer,
    /// `rubric/part` for Tab on a `:::` line: the part it places, or none. True when Tab took
    /// a pick that asks for a change, which opens Change… at once.
    Part(bool),
    /// The drafts of a placed part's line, to open its menu.
    PartLook(bool),
    /// A setting's change: answered with the line.
    Set,
    /// `rubric/parts`, for Insert part…: the words the list is for.
    Parts,
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
pub fn caret_line(s: &State) -> (u32, &str) {
    let line = position::line_char(&s.edit.text, s.edit.focus).0;
    (line, &s.edit.text[position::line_range(&s.edit.text, line)])
}

/// The status of the `new:` line at `line`, as the server last said.
pub fn status_of(s: &State, line: u32) -> Status {
    s.drafts.iter().find(|(l, _)| *l == line).map_or(Status::None { earlier: 0 }, |(_, st)| st.clone())
}

/// The caret's `new:` line with words, its status and its action's id.
fn caret_status(s: &State) -> Option<(u32, String, Said, &'static str)> {
    let (line, text) = caret_line(s);
    let words = new_words(text).filter(|w| !w.is_empty())?;
    let (said, id) = says(&status_of(s, line), words, s.now_ms);
    Some((line, text.to_string(), said, id))
}

/// What the bottom of the writing pane says: something that just happened, or where the
/// caret's `new:` line is.
pub fn line(s: &State) -> Option<Said> {
    if let Some((said, _)) = &s.flash {
        return Some(said.clone());
    }
    caret_status(s).map(|(_, _, said, _)| said)
}

pub fn flash(s: &mut State, label: impl Into<String>, tone: Tone, fact: impl Into<String>) {
    s.now_ms = now_ms();
    s.flash = Some((Said { label: label.into(), tone, fact: fact.into(), action: None }, s.now_ms + FLASH_MS));
    state::wake(s);
}

pub fn failed(s: &mut State, why: impl Into<String>) {
    flash(s, "Failed", Tone::Warn, readable(&why.into()));
}

/// Once a second while a draft runs or a flash shows: the seconds go up, the flash goes.
/// False when nothing it shows changed.
pub fn tick(s: &mut State) -> bool {
    s.now_ms = now_ms();
    let had = s.flash.is_some();
    if s.flash.as_ref().is_some_and(|f| f.1 <= s.now_ms) {
        s.flash = None;
    }
    let drafting = s.drafts.iter().any(|(_, st)| matches!(st, Status::Drafting { .. }));
    if drafting {
        refresh_menu(s);
    }
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
    // The open menu follows its line: a draft that finished shows Keep, not Stop.
    if let Some(open) = &mut s.view
        && let Some(line) = find(&s.edit.text, open.asked.line, &open.asked.text)
        && let Some((_, st)) = s.drafts.iter().find(|(l, _)| *l == line)
    {
        let (status, name) = match st {
            Status::None { .. } => (None, None),
            Status::Drafting { .. } => (Some("drafting"), None),
            Status::Ready { name, .. } => (Some("ready"), Some(name.clone())),
            Status::Failed { .. } => (Some("failed"), None),
        };
        if open.view.status.as_deref() != status {
            open.view.status = status.map(str::to_string);
            if name.is_some() {
                open.view.name = name;
            }
            if let Status::Failed { message } = st {
                open.view.message = message.clone();
            }
            refresh_menu(s);
        }
    }
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
        Some("ready") => flash(s, "Ready", Tone::Accent, readable(name.unwrap_or(words))),
        Some("failed") => flash(s, format!("{} failed", readable(words)), Tone::Warn, params.get("message").and_then(Value::as_str).map(readable).unwrap_or_default()),
        _ => {}
    }
}

pub fn send(s: &mut State, method: &str, what: What, line: u32, text: String, params: Value) {
    let Some(c) = &s.client else { return };
    let id = c.request(method, params);
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
    send(s, "rubric/draft", What::Look, line, text, params);
    true
}

/// The drafter chosen for the line that reads `text`, if one was.
pub fn choice_for<'a>(s: &'a State, text: &str) -> Option<&'a Choice> {
    s.choice.as_ref().filter(|(t, _)| t == text).map(|(_, c)| c)
}

/// The chip for the line: the drafter chosen for it, else the writer's default.
pub fn chip(s: &State, open: &Open) -> Option<String> {
    choice_for(s, &open.asked.text).map(Choice::chip).or_else(|| open.view.drafter.as_deref().map(chip_of))
}

/// The line's first panel, by where its draft is: its rows, title and width.
pub fn menu_rows(view: &View, chip: Option<&str>, elapsed: Option<u64>) -> (Vec<Row>, f32) {
    let with_chip = |i: Item| match chip {
        Some(c) => i.chip(c),
        None => i,
    };
    let reroll = || Row::Item(with_chip(Item::new("reroll", "Reroll").key(Key::Command('r'))));
    let notes = || Row::Item(Item::new("notes", "Reroll with changes…").more());
    let cancel = || Row::Item(Item::new("cancel", "Cancel"));
    match view.status.as_deref() {
        Some("drafting") => {
            let mut note = elapsed.map(clock).unwrap_or_default();
            if let Some(c) = chip {
                note = if note.is_empty() { c.to_string() } else { format!("{note} · {c}") };
            }
            (vec![Row::Head { name: "Drafting".into(), note }, Row::Item(Item::new("stop", "Stop").key(Key::Command('.')))], 220.0)
        }
        Some("ready") => {
            let mut rows = vec![Row::Item(Item::new("keep", "Keep").key(Key::Enter)), reroll(), notes()];
            if view.takes >= 2 {
                rows.push(Row::Item(Item::new("takes", format!("Takes ({})", view.takes)).more()));
            }
            rows.extend([Row::Sep, cancel()]);
            (rows, 250.0)
        }
        Some("failed") => {
            let name = readable(view.name.as_deref().unwrap_or(&view.words));
            let why = view.message.as_deref().map_or_else(|| "No reason given".into(), readable);
            (vec![Row::Title(format!("{name} failed")), Row::Text(why), reroll(), notes(), Row::Sep, cancel()], 270.0)
        }
        _ => {
            let mut rows = vec![Row::Item(with_chip(Item::new("build", "Draft").key(Key::Enter)))];
            if !view.near.is_empty() {
                rows.push(Row::Item(Item::new("near", format!("Similar parts ({})", view.near.len())).more()));
            }
            if view.earlier > 0 {
                rows.push(Row::Item(Item::new("restore", format!("Earlier takes ({})", view.earlier))));
            }
            (rows, 250.0)
        }
    }
}

fn menu_panel(s: &State, open: &Open) -> Option<Panel> {
    if open.part.is_some() {
        return crate::part::panel(s, open);
    }
    if open.view.words.is_empty() {
        return None;
    }
    let elapsed = find(&s.edit.text, open.asked.line, &open.asked.text)
        .and_then(|l| match status_of(s, l) {
            Status::Drafting { started_ms, .. } => Some(s.now_ms.saturating_sub(started_ms)),
            _ => None,
        });
    let (rows, width) = menu_rows(&open.view, chip(s, open).as_deref(), elapsed);
    Some(Panel::new(MENU, readable(&open.view.words), width, rows))
}

/// The line's menu drawn again from what is known now, its focus kept on the same row.
pub fn refresh_menu(s: &mut State) {
    let Some(open) = &s.view else { return };
    // A line of words' menu: only its chip changes.
    if s.panels.first().is_some_and(|p| p.id == crate::insert::WORDS) {
        let chip = chip(s, open);
        for r in &mut s.panels[0].rows {
            if let Row::Item(i) = r
                && i.id == "draft"
            {
                i.chip = chip.clone();
            }
        }
        return;
    }
    if !s.panels.first().is_some_and(|p| p.id == MENU || p.id == crate::part::PART) {
        return;
    }
    let Some(mut fresh) = menu_panel(s, open) else { return };
    if let Some(id) = s.panels[0].active_id().map(str::to_string) {
        fresh.focus(&id);
    }
    if let Some(second) = s.panels.get(1)
        && let Some(from) = second.from.and_then(|i| s.panels[0].rows.get(i)).and_then(Row::id).map(str::to_string)
    {
        let at = fresh.rows.iter().position(|r| r.id() == Some(&from));
        // The row that opened the second panel is gone: the second goes with it.
        match at {
            Some(i) => s.panels[1].from = Some(i),
            None => s.panels.truncate(1),
        }
    }
    s.panels[0] = fresh;
}

/// An answer to a request this module sent.
pub fn answered(s: &mut State, asked: Asked, result: Result<Value, String>) {
    answer(s, asked, result);
    crate::look::sync_field(s);
}

fn answer(s: &mut State, asked: Asked, result: Result<Value, String>) {
    if asked.what == What::Set {
        s.setting = false;
    }
    let answer = match result {
        Ok(v) => v,
        Err(e) => return failed(s, e),
    };
    if let Some(e) = answer.get("error").and_then(Value::as_str) {
        return failed(s, e);
    }
    match asked.what {
        What::Look => {
            // Only for the line the caret is still on, reading as it did.
            let (line, text) = caret_line(s);
            if text != asked.text || find(&s.edit.text, asked.line, &asked.text) != Some(line) {
                return;
            }
            let Some(view) = View::parse(&answer) else { return };
            s.drafter = view.drafter.clone().or(s.drafter.take());
            let open = Open { view, asked, take_before: None, tools: None, offer: None, part: None };
            crate::look::close_panels(s);
            if let Some(p) = menu_panel(s, &open) {
                s.panels = vec![p];
                s.view = Some(open);
            }
        }
        What::Build => {}
        What::Act => {
            if replace(&mut s.edit, &asked, &answer) {
                state::changed(s);
            }
            // A new part kept: its name, and that the site has it now.
            if is_new_line(&asked.text)
                && let Some(name) = answer.get("part").and_then(|p| p.get("name")).and_then(Value::as_str)
            {
                flash(s, "Kept", Tone::Ink, format!("{}, added to Own parts", readable(name)));
            }
        }
        What::Part(_) | What::PartLook(_) | What::Set | What::Parts => crate::part::answered(s, asked, answer),
        What::Take => {
            let Some(open) = s.view.as_mut().filter(|o| o.asked.text == asked.text) else { return };
            let Some(view) = View::parse(&answer) else { return };
            open.view = view;
            let shown = open.view.take;
            if let Some(p) = s.panels.iter_mut().find(|p| p.id == TAKES) {
                for (n, r) in p.rows.iter_mut().enumerate() {
                    if let Row::Item(i) = r {
                        i.check = shown == Some(n as u32);
                    }
                }
            }
        }
        What::Tools => {
            let Some(open) = s.view.as_mut().filter(|o| o.asked.text == asked.text) else { return };
            open.tools = answer.as_array().map(|a| a.iter().filter_map(|t| {
                Some((t.get("name")?.as_str()?.to_string(), t.get("version").is_some_and(|v| !v.is_null())))
            }).collect());
            drafter_panel(s);
        }
        What::Offer => {
            let Some(open) = s.view.as_mut().filter(|o| o.asked.text == asked.text) else { return };
            open.offer = Offer::parse(&answer);
            drafter_panel(s);
        }
    }
}

/// The menu's line is gone (the panels closed): a part being looked at leaves the page.
pub fn closed(s: &mut State, peeking: bool) {
    if peeking {
        peek(s, None);
    }
    s.view = None;
}

/// The page draws `part` on the menu's line, or with none, the line as it is.
pub fn peek(s: &State, part: Option<&str>) {
    let (Some(c), Some(open)) = (&s.client, &s.view) else { return };
    let line = find(&s.edit.text, open.asked.line, &open.asked.text).unwrap_or(open.asked.line);
    c.notify("rubric/peek", json!({ "uri": s.uri, "line": line, "part": part }));
}

/// The focus moved in the panel `id`: in Similar parts the page draws that part; in Takes the
/// page shows that take.
pub fn moved(s: &mut State, id: &str) {
    let active = s.panels.last().and_then(Panel::active_id).map(str::to_string);
    match (id, active) {
        (NEAR, Some(part)) => peek(s, Some(&part)),
        (TAKES, Some(take)) => {
            if let Some(n) = take.strip_prefix("take-").and_then(|n| n.parse::<u32>().ok()) {
                ask_take(s, n);
            }
        }
        _ => crate::insert::moved(s, id),
    }
}

fn ask_take(s: &mut State, to: u32) {
    let Some(open) = &s.view else { return };
    let Some(line) = find(&s.edit.text, open.asked.line, &open.asked.text) else { return };
    let mut p = params(Some("take"), &s.uri, line);
    p["to"] = json!(to);
    let text = open.asked.text.clone();
    send(s, "rubric/draft", What::Take, line, text, p);
}

/// Sends `action` for the line that read `text` at `line`, with `extra` beside it; build and
/// reroll carry the drafter chosen for the line.
pub fn ask(s: &mut State, action: &str, what: What, line: u32, text: String, extra: Value) {
    let mut p = params(Some(action), &s.uri, line);
    if let (Some(p), Some(e)) = (p.as_object_mut(), extra.as_object()) {
        p.extend(e.clone());
    }
    if matches!(action, "build" | "reroll")
        && let Some(c) = choice_for(s, &text)
    {
        p["drafter"] = c.json();
    }
    send(s, "rubric/draft", what, line, text, p);
}

/// Does the action `id` on the line, as its menu row or its key on the status line does.
fn perform(s: &mut State, id: &str, line: u32, text: String) {
    match id {
        "build" => ask(s, "build", What::Build, line, text, json!({})),
        "reroll" => ask(s, "reroll", What::Build, line, text, json!({ "change": "" })),
        "restore" => ask(s, "restore", What::Build, line, text, json!({})),
        "stop" | "cancel" => ask(s, id, What::Act, line, text, json!({})),
        "keep" => ask(s, "keep", What::Act, line, text, json!({ "global": false })),
        _ => {}
    }
}

/// The status line's key, on a `new:` line with no panel open: Cmd+Enter drafts or keeps,
/// Cmd+R rerolls, Cmd+. stops. True when it was taken.
pub fn status_key(s: &mut State, ev: &KeyEvent) -> bool {
    if !s.panels.is_empty() {
        return false;
    }
    let Some((line, text, said, id)) = caret_status(s) else { return false };
    if s.flash.is_some() || !said.action.is_some_and(|(_, k)| k.matches(ev)) {
        return false;
    }
    perform(s, id, line, text);
    true
}

/// A press on the status line's action.
pub fn status_pressed(s: &mut State) {
    if s.flash.is_some() {
        return;
    }
    if let Some((line, text, _, id)) = caret_status(s) {
        perform(s, id, line, text);
    }
}

/// What a draft panel (`id`) answered.
pub fn act(s: &mut State, id: &str, taken: Taken, tx: &mut Tx) {
    if crate::part::owns(id) {
        return crate::part::act(s, id, taken, tx);
    }
    if crate::insert::owns(id) {
        return crate::insert::act(s, id, taken, tx);
    }
    let Some(open) = s.view.clone() else { return };
    let Some(line) = find(&s.edit.text, open.asked.line, &open.asked.text) else {
        s.panels.clear();
        return closed(s, false);
    };
    let text = open.asked.text.clone();
    // Asked and done: the panels close.
    let done = |s: &mut State| {
        let peeking = s.panels.iter().any(|p| p.id == NEAR);
        s.panels.clear();
        closed(s, peeking);
    };
    match (id, taken) {
        (MENU, Taken::Chose(row)) => match row.as_str() {
            "near" => {
                let rows = std::iter::once(Row::Head { name: "Similar parts".into(), note: open.view.near.len().to_string() })
                    .chain(open.view.near.iter().map(|n| {
                        let note = if n.own { format!("Own · {}", n.description) } else { n.description.clone() };
                        Row::Item(Item::new(n.name.clone(), readable(&n.name)).note(note))
                    }))
                    .collect();
                second(s, Panel::new(NEAR, "Similar parts", 264.0, rows), "near");
                moved(s, NEAR);
            }
            "notes" => {
                s.field = TextEdit::new("");
                let reroll = Item::new("reroll", "Reroll").key(Key::Enter);
                let reroll = match chip(s, &open) {
                    Some(c) => reroll.chip(c),
                    None => reroll,
                };
                let rows = vec![
                    Row::Head { name: "Reroll with changes".into(), note: String::new() },
                    Row::Field { id: "notes".into(), label: None, placeholder: "What to change".into(), value: String::new() },
                    Row::Sep,
                    Row::Item(reroll),
                ];
                second(s, Panel::new(NOTES, "Reroll with changes", 280.0, rows), "notes");
            }
            "takes" => {
                let shown = open.view.take;
                let rows = std::iter::once(Row::Head { name: "Takes".into(), note: open.view.takes.to_string() })
                    .chain(open.view.list.iter().enumerate().map(|(n, t)| {
                        let n = n as u32 + 1;
                        let note = match (&t.by, &t.change) {
                            (Some(by), Some(c)) => format!("{} · “{c}”", chip_of(by)),
                            (Some(by), None) => chip_of(by),
                            (None, Some(c)) => format!("“{c}”"),
                            (None, None) => String::new(),
                        };
                        Row::Item(Item::new(format!("take-{n}"), format!("Take {n}")).note(note).check(shown == Some(n)))
                    }))
                    .collect();
                if let Some(o) = &mut s.view {
                    o.take_before = shown;
                }
                second(s, Panel::new(TAKES, "Takes", 250.0, rows), "takes");
                if let Some(n) = shown {
                    s.panels[1].focus(&format!("take-{n}"));
                }
            }
            other => {
                perform(s, other, line, text);
                done(s);
            }
        },
        (MENU, Taken::Chip(_)) => open_drafter(s),
        (MENU, Taken::Closed | Taken::Passed) => closed(s, false),
        (NEAR, Taken::Chose(part)) => {
            // The part stays on the page until the answer's line draws it.
            s.panels.clear();
            s.view = None;
            send(s, "rubric/draft", What::Act, line, text, {
                let mut p = params(Some("use"), &s.uri, line);
                p["part"] = json!(part);
                p
            });
        }
        (NEAR, Taken::Back) => peek(s, None),
        (NEAR, Taken::Closed | Taken::Passed) => closed(s, true),
        (TAKES, Taken::Chose(_)) => {
            // Stays on the take shown: back to the menu.
            s.panels.truncate(1);
            if let Some(o) = &mut s.view {
                o.take_before = None;
            }
            tx.focus("editor", false);
        }
        (TAKES, Taken::Back) => {
            if let Some(n) = open.take_before {
                ask_take(s, n);
            }
            if let Some(o) = &mut s.view {
                o.take_before = None;
            }
        }
        (TAKES, Taken::Closed | Taken::Passed) => closed(s, false),
        (NOTES, Taken::Submitted(..) | Taken::Chose(_)) => {
            let words = s.field.text.trim().to_string();
            ask(s, "reroll", What::Build, line, text, json!({ "change": words }));
            done(s);
        }
        (NOTES, Taken::Closed | Taken::Passed) => closed(s, false),
        (DRAFTER, Taken::Chose(row)) => {
            let mut c = choice_for(s, &text).cloned().or_else(|| open.offer.as_ref().map(|o| o.default.clone())).unwrap_or_default();
            if let Some(tool) = row.strip_prefix("tool:") {
                if c.harness == tool {
                    return;
                }
                c = Choice { harness: tool.to_string(), model: None, effort: None };
                if let Some(o) = &mut s.view {
                    o.offer = None;
                }
                s.choice = Some((text.clone(), c.clone()));
                ask_offer(s, &c, line, &text);
            } else if let Some(model) = row.strip_prefix("model:") {
                c.model = Some(model.to_string());
                s.choice = Some((text.clone(), c.clone()));
                ask_offer(s, &c, line, &text);
            }
            drafter_panel(s);
            refresh_menu(s);
        }
        (DRAFTER, Taken::Set(_, n)) => {
            let Some(effort) = open.offer.as_ref().and_then(|o| o.efforts.get(n)).cloned() else { return };
            let mut c = choice_for(s, &text).cloned().or_else(|| open.offer.as_ref().map(|o| o.default.clone())).unwrap_or_default();
            c.effort = Some(effort);
            s.choice = Some((text, c));
            refresh_menu(s);
        }
        (DRAFTER, Taken::Closed | Taken::Passed) => closed(s, false),
        _ => {}
    }
}

/// Opens `p` beside the menu at the row `from`, in place of any second panel.
pub fn second(s: &mut State, mut p: Panel, from: &str) {
    s.panels.truncate(1);
    p.from = s.panels[0].rows.iter().position(|r| r.id() == Some(from));
    s.panels.push(p);
}

/// The chip was pressed, or Right on its row: the drafter's panel, once the server said what
/// it offers.
pub fn open_drafter(s: &mut State) {
    let Some(open) = &s.view else { return };
    let Some(line) = find(&s.edit.text, open.asked.line, &open.asked.text) else { return };
    let text = open.asked.text.clone();
    let c = choice_for(s, &text).cloned();
    s.panels.truncate(1);
    if let Some(o) = &mut s.view {
        o.tools = None;
        o.offer = None;
    }
    send(s, "rubric/harnesses", What::Tools, line, text.clone(), json!({}));
    let p = c.map_or_else(|| json!({}), |c| json!({ "harness": c.harness, "model": c.model }));
    send(s, "rubric/drafter", What::Offer, line, text, p);
}

/// Asks what the chosen tool (and model) offers.
fn ask_offer(s: &mut State, c: &Choice, line: u32, text: &str) {
    let mut p = json!({ "harness": c.harness });
    if let Some(m) = &c.model {
        p["model"] = json!(m);
    }
    send(s, "rubric/drafter", What::Offer, line, text.to_string(), p);
}

/// The drafter's panel, beside the row its chip is on, once both answers are in; drawn again
/// as choices change it.
fn drafter_panel(s: &mut State) {
    let Some(open) = &s.view else { return };
    let (Some(tools), Some(offer)) = (&open.tools, &open.offer) else { return };
    if !s.panels.first().is_some_and(|p| p.id == MENU || p.id == crate::part::PART || p.id == crate::insert::WORDS) {
        return;
    }
    let c = choice_for(s, &open.asked.text).cloned().unwrap_or_else(|| offer.default.clone());
    let mut rows = vec![Row::Head { name: "Tool".into(), note: String::new() }];
    for (name, installed) in tools {
        let item = Item::new(format!("tool:{name}"), tool_name(name)).check(*name == c.harness);
        rows.push(Row::Item(if *installed { item } else { item.note("Not installed").off() }));
    }
    if !offer.models.is_empty() {
        rows.extend([Row::Sep, Row::Head { name: "Model".into(), note: String::new() }]);
        let on = c.model.clone().or_else(|| (offer.default.harness == c.harness).then(|| offer.default.model.clone()).flatten());
        for m in &offer.models {
            rows.push(Row::Item(Item::new(format!("model:{m}"), readable(m)).check(on.as_deref() == Some(m))));
        }
    }
    if !offer.efforts.is_empty() {
        let on = c.effort.as_ref().and_then(|e| offer.efforts.iter().position(|x| x == e)).unwrap_or(0);
        rows.extend([Row::Sep, Row::Seg { id: "effort".into(), label: "Effort".into(), choices: offer.efforts.iter().map(|e| readable(e)).collect(), on }]);
    }
    let from = s.panels[0].rows.iter().position(|r| matches!(r, Row::Item(i) if i.chip.is_some()));
    let mut p = Panel::new(DRAFTER, "Drafter", 250.0, rows);
    p.from = from;
    match s.panels.get_mut(1).filter(|q| q.id == DRAFTER) {
        // Drawn again: the focus stays on its row.
        Some(old) => {
            if let Some(id) = old.active_id().map(str::to_string) {
                p.focus(&id);
            }
            *old = p;
        }
        None => {
            p.focus(&format!("tool:{}", c.harness));
            s.panels.truncate(1);
            s.panels.push(p);
        }
    }
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
            note("draft-failed", 9, json!({ "status": "failed", "message": "no part" })),
            note("unknown-part", 11, json!({})),
            { "source": "other", "code": "drafting", "range": { "start": { "line": 12, "character": 0 } }, "message": "m" },
        ] });
        assert_eq!(statuses(&params), vec![
            (1, Status::None { earlier: 2 }),
            (4, Status::Drafting { started_ms: 1000, shown: Some("tide-clock".into()) }),
            (7, Status::Ready { name: "tide-clock".into(), settings: vec!["pace".into()] }),
            (9, Status::Failed { message: Some("no part".into()) }),
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
    fn the_status_counts_the_time_and_offers_one_action_by_state() {
        let (drafting, id) = says(&Status::Drafting { started_ms: 1_000, shown: None }, "a clock", 75_400);
        assert!(drafting.label.contains("1:14"), "{drafting:?}");
        assert_eq!(id, "stop");
        let ids: Vec<_> = [Status::None { earlier: 0 }, Status::Ready { name: "x".into(), settings: vec![] }, Status::Failed { message: Some("no part".into()) }]
            .iter().map(|st| says(st, "a clock", 0).1).collect();
        assert_eq!(ids, ["build", "keep", "reroll"]);
        let (failed, _) = says(&Status::Failed { message: Some("no part".into()) }, "a clock", 0);
        assert_eq!((failed.tone, failed.fact.as_str()), (Tone::Warn, "No part"), "the reason is the fact");
        assert_eq!(says(&Status::None { earlier: 0 }, "a clock", 0).0.tone, Tone::Dim);
    }

    fn view(v: Value) -> View {
        View::parse(&v).unwrap()
    }

    fn ids(view: &View) -> Vec<String> {
        menu_rows(view, Some("Opus · low"), None).0.iter().filter_map(|r| r.id().map(str::to_string)).collect()
    }

    #[test]
    fn the_menu_follows_where_the_draft_is() {
        assert_eq!(ids(&view(json!({ "words": "a clock" }))), ["build"]);
        let near = json!([{ "name": "quote", "description": "A quote", "own": false }]);
        assert_eq!(ids(&view(json!({ "words": "a clock", "near": near, "earlier": 2 }))), ["build", "near", "restore"]);
        assert_eq!(ids(&view(json!({ "words": "a clock", "status": "drafting" }))), ["stop"]);
        assert_eq!(ids(&view(json!({ "words": "a clock", "status": "ready", "name": "clock", "take": 1, "takes": 1 }))), ["keep", "reroll", "notes", "cancel"]);
        assert_eq!(ids(&view(json!({ "words": "a clock", "status": "ready", "name": "clock", "take": 2, "takes": 2 }))), ["keep", "reroll", "notes", "takes", "cancel"], "Takes from two");
        assert_eq!(ids(&view(json!({ "words": "a clock", "status": "failed", "message": "no" }))), ["reroll", "notes", "cancel"]);
    }

    #[test]
    fn the_chip_is_on_draft_and_reroll() {
        let chips = |v: Value| -> Vec<String> {
            menu_rows(&view(v), Some("Opus · low"), None).0.iter().filter_map(|r| match r {
                Row::Item(i) if i.chip.is_some() => Some(i.id.clone()),
                _ => None,
            }).collect()
        };
        assert_eq!(chips(json!({ "words": "a" })), ["build"]);
        assert_eq!(chips(json!({ "words": "a", "status": "ready" })), ["reroll"]);
        assert_eq!(chip_of("opus, low, tools"), "Opus · low · tools");
        assert_eq!(Choice { harness: "claude".into(), model: Some("sonnet".into()), effort: Some("high".into()) }.chip(), "Sonnet · high");
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
