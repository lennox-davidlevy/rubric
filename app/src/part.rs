//! A placed part's line: Tab asks the server what the part is (`rubric/part`) and what its
//! drafts are (`rubric/draft`), and opens the design's `part-menu`: the part's settings, its
//! look, a line of words, Change… (a new variant), its takes, and Remove. A setting's change
//! is the server's to write (`rubric/part` with `set`); the app puts the answer's line in
//! place. Neovim's `act_own` (`editors/nvim/lua/rubric/drafts.lua`) is the model.

use rune::{Key, TextEdit, Tx};
use serde_json::{Value, json};

use crate::draft::{self, Asked, Open, View, What, find, readable};
use crate::panel::{Item, Panel, Row, Taken};
use crate::position;
use crate::state::{self, State};

/// The panels' ids: the part's menu, a choice of more than four values, Change…, Remove….
pub const PART: &str = "part";
pub const CHOICES: &str = "part-choices";
pub const CHANGE: &str = "change";
pub const REMOVE: &str = "remove";

/// A choice with more values than this is a second panel of items, not a row of segments.
const SEGMENTS: usize = 4;
const WIDTH: f32 = 276.0;

pub fn owns(id: &str) -> bool {
    matches!(id, PART | CHOICES | CHANGE | REMOVE)
}

/// What `rubric/part` answers.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Part {
    pub name: String,
    /// "catalog", "own" or "variant".
    pub kind: String,
    pub variant: Option<Variant>,
    /// Every block on the site drawing it, this one with them.
    pub blocks: u32,
    pub settings: Vec<Setting>,
    pub look: Vec<Setting>,
    /// The block's closing line, when it has one, as the line was when asked.
    pub close: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Variant {
    pub of: String,
    pub name: String,
    pub everywhere: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Setting {
    pub name: String,
    /// What it takes: none for text and numbers.
    pub values: Vec<String>,
    pub default: Option<String>,
    /// What the line sets.
    pub value: Option<String>,
}

impl Setting {
    fn parse(v: &Value) -> Option<Setting> {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Some(Setting {
            name: text("name")?,
            values: v.get("values").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default(),
            default: text("default"),
            value: text("value"),
        })
    }

    /// The value the line draws with: its own, else the default.
    fn shown(&self) -> Option<&str> {
        self.value.as_deref().or(self.default.as_deref())
    }

    fn row(&self) -> Row {
        let id = format!("set:{}", self.name);
        let label = readable(&self.name);
        if self.values.is_empty() {
            return Row::Field { id, label: Some(label), placeholder: "None".into(), value: self.value.clone().unwrap_or_default() };
        }
        let on = self.shown().and_then(|v| self.values.iter().position(|x| x == v)).unwrap_or(0);
        if self.values.len() <= SEGMENTS {
            Row::Seg { id, label, choices: self.values.iter().map(|v| readable(v)).collect(), on }
        } else {
            Row::Item(Item::new(id, label).note(self.values.get(on).map(|v| readable(v)).unwrap_or_default()).more())
        }
    }
}

impl Part {
    pub fn parse(v: &Value) -> Option<Part> {
        let list = |k: &str| v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Setting::parse).collect()).unwrap_or_default();
        Some(Part {
            name: v.get("name")?.as_str()?.to_string(),
            kind: v.get("kind").and_then(Value::as_str).unwrap_or("catalog").to_string(),
            variant: v.get("variant").and_then(|x| Some(Variant {
                of: x.get("of")?.as_str()?.to_string(),
                name: x.get("name")?.as_str()?.to_string(),
                everywhere: x.get("everywhere").and_then(Value::as_bool).unwrap_or(false),
            })),
            blocks: v.get("uses").and_then(|u| u.get("blocks")).and_then(Value::as_u64).unwrap_or(0) as u32,
            settings: list("settings"),
            look: list("look"),
            close: v.get("close").and_then(Value::as_u64).map(|n| n as u32),
        })
    }

    fn setting_mut(&mut self, name: &str) -> Option<&mut Setting> {
        self.settings.iter_mut().chain(self.look.iter_mut()).find(|x| x.name == name)
    }

    fn setting(&self, name: &str) -> Option<&Setting> {
        self.settings.iter().chain(self.look.iter()).find(|x| x.name == name)
    }

    /// "Quote", or "Quote · torn-edge" for a variant.
    fn title(&self) -> String {
        match &self.variant {
            Some(v) => format!("{} · {}", readable(&v.of), v.name),
            None => readable(&self.name),
        }
    }
}

/// The key that removes: Cmd+Backspace on the Mac, Ctrl+Delete elsewhere.
pub fn remove_key() -> Key {
    if cfg!(target_os = "macos") { Key::Backspace } else { Key::Delete }
}

/// A `:::` line that names something: not a closer, not `new:`, not the theme line.
pub fn names_something(line: &str) -> bool {
    let t = line.trim_start_matches([' ', '\t']);
    let after = t.trim_start_matches(':');
    if t.len() - after.len() < 3 {
        return false;
    }
    let words = after.trim();
    !words.is_empty() && !draft::is_new_line(line) && words != "theme" && !words.starts_with("theme ")
}

/// Where the words after a lone `:` start on a `:::` line: the byte of that `:`, outside any
/// quoted value and with a space before it.
pub fn refine_colon(line: &str) -> Option<usize> {
    let t = line.trim_start_matches([' ', '\t']);
    let start = line.len() - t.len() + (t.len() - t.trim_start_matches(':').len());
    let mut quoted = false;
    let mut prev = b' ';
    for (i, b) in line.bytes().enumerate().skip(start) {
        match b {
            b'"' => quoted = !quoted,
            b':' if !quoted && prev.is_ascii_whitespace() => return Some(i),
            _ => {}
        }
        prev = b;
    }
    None
}

/// The line without the words after its `:`.
pub fn lead(line: &str) -> &str {
    refine_colon(line).map_or(line, |c| &line[..c]).trim_end()
}

/// The line `at` becomes `new` as one undo step, the caret at its end.
pub fn set_line(edit: &mut TextEdit, at: u32, new: &str) {
    let r = position::line_range(&edit.text, at);
    let new = new.to_string();
    edit.undo_group(|e| {
        e.set_selection(r.start, r.end);
        e.insert(&new);
        e.set_caret(r.start + new.len());
    });
}

/// The part's line `at` and its closer `close` go, as one undo step; what is between stays.
/// The caret goes to where the line was. Without a closer, the line alone goes.
pub fn unwrap(edit: &mut TextEdit, at: u32, close: Option<u32>) {
    let closer = close.filter(|&c| c > at).filter(|&c| {
        let r = position::line_range(&edit.text, c);
        let t = edit.text[r].trim();
        t.len() >= 3 && t.bytes().all(|b| b == b':')
    });
    let cut = |text: &str, line: u32| -> (usize, usize) {
        let r = position::line_range(text, line);
        // The line goes with its newline; the last line takes the one before it.
        if r.end < text.len() { (r.start, r.end + 1) } else { (r.start.saturating_sub(1), r.end) }
    };
    let first = cut(&edit.text, at);
    edit.undo_group(|e| {
        if let Some(c) = closer {
            let (a, b) = cut(&e.text, c);
            e.set_selection(a, b);
            e.insert("");
        }
        e.set_selection(first.0, first.1);
        e.insert("");
        let caret = first.0.min(e.text.len());
        e.set_caret(caret);
    });
}

/// Tab on a `:::` line that names something: asks the server what part it places. `change`
/// when Tab took a pick that asks for a change. False on any other line.
pub fn tab(s: &mut State, change: bool) -> bool {
    let (line, text) = draft::caret_line(s);
    if !names_something(text) {
        return false;
    }
    let text = text.to_string();
    state::start_look(s);
    let p = json!({ "uri": s.uri, "line": line });
    draft::send(s, "rubric/part", What::Part(change), line, text, p);
    true
}

/// The answers to `rubric/part` and the line's drafts, and to a setting's change.
pub fn answered(s: &mut State, asked: Asked, answer: Value) {
    match asked.what {
        What::Part(change) => {
            if !still_there(s, &asked) {
                return;
            }
            let Some(part) = Part::parse(&answer) else {
                // No part: words the catalog has no part for, or a part the site lacks.
                return crate::insert::words_menu(s, asked);
            };
            s.part_wait = Some(part);
            let p = draft::params(None, &s.uri, asked.line);
            draft::send(s, "rubric/draft", What::PartLook(change), asked.line, asked.text, p);
        }
        What::PartLook(change) => {
            let Some(part) = s.part_wait.take() else { return };
            if !still_there(s, &asked) {
                return;
            }
            let view = View::parse(&answer).unwrap_or_default();
            let open = Open { view, asked: Asked { what: What::Look, ..asked }, take_before: None, tools: None, offer: None, part: Some(part) };
            crate::look::close_panels(s);
            let Some(p) = panel(s, &open) else { return };
            let changes = open.view.of.is_some();
            s.panels = vec![p];
            s.view = Some(open);
            if change && changes {
                open_change(s);
                s.focus_field = true;
            }
        }
        What::Set => {
            let at = find(&s.edit.text, asked.line, &asked.text);
            if draft::replace(&mut s.edit, &asked, &answer) {
                if let (Some(open), Some(at)) = (s.view.as_mut(), at) {
                    open.asked.line = at;
                    open.asked.text = s.edit.text[position::line_range(&s.edit.text, at)].to_string();
                }
                state::rewritten(s);
            }
            if let Some((name, value)) = s.set_next.take() {
                send_set(s, &name, &value);
            }
        }
        What::Parts => crate::insert::parts_answered(s, asked, answer),
        _ => {}
    }
}

/// The caret is still on the line asked about, which reads as it did.
fn still_there(s: &State, asked: &Asked) -> bool {
    let (line, text) = draft::caret_line(s);
    text == asked.text && find(&s.edit.text, asked.line, &asked.text) == Some(line)
}

/// The part's menu, by where its drafts are.
pub fn panel(s: &State, open: &Open) -> Option<Panel> {
    let part = open.part.as_ref()?;
    let chip = draft::chip(s, open);
    let (rows, width) = rows(part, &open.view, chip.as_deref());
    Some(Panel::new(PART, part.title(), width, rows))
}

/// The rows of a part's menu: while a take of it (or of a new variant) drafts or waits, the
/// draft's rows with a way back; otherwise its settings, look, words, Change…, what its kind
/// offers, and Remove.
pub fn rows(part: &Part, view: &View, chip: Option<&str>) -> (Vec<Row>, f32) {
    let with_chip = |i: Item| match chip {
        Some(c) => i.chip(c),
        None => i,
    };
    let reroll = || Row::Item(with_chip(Item::new("reroll", "Reroll").key(Key::Command('r'))));
    let notes = || Row::Item(Item::new("notes", "Reroll with changes…").more());
    // Throws away the take or variant drafting, ready or failed, as a `new:` line's Cancel does.
    let back = || Row::Item(Item::new("cancel", "Cancel"));
    let title = part.title();
    match view.status.as_deref() {
        Some("drafting") => {
            return (vec![
                Row::Head { name: title, note: chip.unwrap_or_default().to_string() },
                Row::Item(Item::new("stop", "Stop").key(Key::Command('.'))),
                Row::Sep,
                back(),
            ], 250.0);
        }
        Some("ready") => {
            let mut rows = vec![Row::Head { name: title, note: String::new() }, Row::Item(Item::new("keep", "Keep").key(Key::Enter)), reroll(), notes()];
            if view.takes >= 2 {
                rows.push(Row::Item(Item::new("takes", format!("Takes ({})", view.takes)).more()));
            }
            rows.extend([Row::Sep, back()]);
            return (rows, 250.0);
        }
        Some("failed") => {
            let why = view.message.as_deref().map_or_else(|| "No reason given".into(), readable);
            return (vec![Row::Title(format!("{title} failed")), Row::Text(why), reroll(), notes(), Row::Sep, back()], 270.0);
        }
        _ => {}
    }
    let note = match (&part.variant, part.kind.as_str()) {
        (Some(v), _) if v.everywhere => format!("Every {}", v.of),
        (None, "own") => draft::CUSTOM.into(),
        _ => String::new(),
    };
    let mut rows = vec![Row::Head { name: title, note }];
    rows.extend(part.settings.iter().map(Setting::row));
    if !part.look.is_empty() {
        rows.extend([Row::Sep, Row::Head { name: "Look".into(), note: String::new() }]);
        rows.extend(part.look.iter().map(Setting::row));
    }
    rows.extend([Row::Sep, Row::Field { id: "words".into(), label: None, placeholder: "In words: bigger, centered".into(), value: String::new() }]);
    let changes = view.of.is_some();
    let own = part.kind != "catalog";
    if changes || own {
        rows.push(Row::Sep);
    }
    if changes {
        rows.push(Row::Item(Item::new("change", "Change…").more()));
    }
    if own && changes {
        if view.takes >= 2 {
            rows.push(Row::Item(Item::new("takes", format!("Takes ({})", view.takes)).more()));
        }
        rows.push(reroll());
    }
    match &part.variant {
        Some(v) => {
            rows.push(Row::Sep);
            let every = if v.everywhere { format!("Every {} plain", v.of) } else { format!("Every {} as {}", v.of, v.name) };
            rows.push(Row::Item(Item::new("everywhere", every)));
            rows.push(Row::Item(Item::new("plain", "Revert to original")));
        }
        None if part.kind == "own" => rows.push(Row::Item(Item::new("global", "Add to every site"))),
        None => {}
    }
    rows.push(Row::Sep);
    rows.push(Row::Item(if own {
        Item::new("remove-ask", "Remove…").danger().key(remove_key()).more()
    } else {
        Item::new("remove", "Remove").danger().key(remove_key())
    }));
    (rows, WIDTH)
}

/// What a part's panel (`id`) answered.
pub fn act(s: &mut State, id: &str, taken: Taken, tx: &mut Tx) {
    let Some(open) = s.view.clone() else { return };
    let Some(part) = open.part.clone() else { return };
    let Some(line) = find(&s.edit.text, open.asked.line, &open.asked.text) else {
        s.panels.clear();
        return draft::closed(s, false);
    };
    match (id, taken) {
        (PART, Taken::Set(row, n)) => {
            let Some(name) = row.strip_prefix("set:") else { return };
            let Some(value) = part.setting(name).and_then(|x| x.values.get(n)).map(|v| v.to_string()) else { return };
            send_set(s, name, &value);
        }
        (PART, Taken::Submitted(row, words)) if row == "words" => {
            let new = match words.trim() {
                "" => lead(&open.asked.text).to_string(),
                w => format!("{} : {w}", lead(&open.asked.text)),
            };
            close(s);
            set_line(&mut s.edit, line, &new);
            state::changed(s);
        }
        (PART, Taken::Submitted(row, value)) => {
            if let Some(name) = row.strip_prefix("set:") {
                send_set(s, name, value.trim());
            }
        }
        (PART, Taken::Chose(row)) => match row.as_str() {
            "change" => open_change(s),
            "remove" => {
                close(s);
                unwrap(&mut s.edit, line, part.close.and_then(|c| c.checked_sub(open.asked.line)).map(|d| line + d));
                state::changed(s);
                draft::flash(s, "Removed", draft::Tone::Ink, format!("{}, from this block", part.title()));
            }
            "remove-ask" => {
                let blocks = part.blocks.max(1);
                let rows = vec![
                    Row::Title(format!("{} is in {blocks} block{}", part.title(), if blocks == 1 { "" } else { "s" })),
                    Row::Item(Item::new("keep", "Keep")),
                    Row::Item(Item::new("unwrap", "Remove from this block")),
                    Row::Sep,
                    Row::Item(Item::new("remove-site", "Remove from site").danger()),
                ];
                draft::second(s, Panel::new(REMOVE, "Remove", 250.0, rows), "remove-ask");
            }
            "global" => {
                draft::ask_then_say(s, "keep", line, open.asked.text.clone(), json!({ "global": true }), "Kept", format!("{}, in every site", part.title()));
                close(s);
            }
            "everywhere" => {
                let on = !part.variant.as_ref().is_some_and(|v| v.everywhere);
                draft::ask(s, "everywhere", What::Act, line, open.asked.text.clone(), json!({ "on": on }));
                close(s);
            }
            "plain" => {
                draft::ask(s, "plain", What::Act, line, open.asked.text.clone(), json!({}));
                close(s);
            }
            name if name.starts_with("set:") => {
                let Some(x) = part.setting(&name[4..]) else { return };
                let rows = std::iter::once(Row::Head { name: readable(&x.name), note: String::new() })
                    .chain(x.values.iter().map(|v| Row::Item(Item::new(v.clone(), readable(v)).check(x.shown() == Some(v.as_str())))))
                    .collect();
                let mut p = Panel::new(CHOICES, readable(&x.name), 220.0, rows);
                if let Some(v) = x.shown() {
                    p.focus(v);
                }
                draft::second(s, p, name);
            }
            // The draft's own rows: as on a `new:` line.
            _ => draft::act(s, draft::MENU, Taken::Chose(row), tx),
        },
        (PART | CHANGE, Taken::Chip(row)) => draft::act(s, draft::MENU, Taken::Chip(row), tx),
        (CHOICES, Taken::Chose(value)) => {
            let Some(row) = s.panels.first().and_then(|p| second_from(s, p)) else { return };
            s.panels.truncate(1);
            if let Some(name) = row.strip_prefix("set:") {
                send_set(s, name, &value);
            }
            tx.focus("editor", false);
        }
        (CHANGE, Taken::Submitted(..) | Taken::Chose(_)) => {
            let words = s.field.text.trim().to_string();
            if words.is_empty() {
                return;
            }
            // The words go after the line's ":", in place of any there, and the draft
            // starts from them; a drafter chosen for the line goes with it.
            let new = format!("{} : {words}", lead(&open.asked.text));
            let mut extra = json!({ "variant": true });
            if let Some(c) = draft::choice_for(s, &open.asked.text) {
                extra["drafter"] = c.json();
            }
            close(s);
            set_line(&mut s.edit, line, &new);
            state::changed(s);
            let mut p = draft::params(Some("build"), &s.uri, line);
            if let (Some(p), Some(e)) = (p.as_object_mut(), extra.as_object()) {
                p.extend(e.clone());
            }
            draft::send(s, "rubric/draft", What::Build, line, new, p);
        }
        (REMOVE, Taken::Chose(row)) => match row.as_str() {
            "keep" => {
                s.panels.truncate(1);
                tx.focus("editor", false);
            }
            "unwrap" => {
                close(s);
                unwrap(&mut s.edit, line, part.close.and_then(|c| c.checked_sub(open.asked.line)).map(|d| line + d));
                state::changed(s);
                draft::flash(s, "Removed", draft::Tone::Ink, format!("{}, from this block", part.title()));
            }
            "remove-site" => {
                draft::ask_then_say(s, "remove", line, open.asked.text.clone(), json!({}), "Removed", format!("{}, from this site", part.title()));
                close(s);
            }
            _ => {}
        },
        (_, Taken::Closed | Taken::Passed) => draft::closed(s, false),
        _ => {}
    }
}

/// The id of the row of `first` that opened the second panel.
fn second_from(s: &State, first: &Panel) -> Option<String> {
    s.panels.get(1)?.from.and_then(|i| first.rows.get(i)).and_then(Row::id).map(str::to_string)
}

/// The panels close, and the menu's line is let go.
fn close(s: &mut State) {
    s.panels.clear();
    draft::closed(s, false);
}

/// Change…: what to change, then "Draft variant" with the drafter.
fn open_change(s: &mut State) {
    let Some(open) = &s.view else { return };
    let Some(part) = &open.part else { return };
    let of = part.variant.as_ref().map_or(part.name.as_str(), |v| v.of.as_str()).to_string();
    let words = open.view.change.clone().unwrap_or_default();
    let draft = Item::new("variant", "Draft variant").key(Key::Enter);
    let draft = match draft::chip(s, open) {
        Some(c) => draft.chip(c),
        None => draft,
    };
    let rows = vec![
        Row::Head { name: format!("Change {of}"), note: String::new() },
        Row::Field { id: "words".into(), label: None, placeholder: "What to change".into(), value: words },
        Row::Sep,
        Row::Item(draft),
    ];
    draft::second(s, Panel::new(CHANGE, "Change", 250.0, rows), "change");
}

/// Sends a setting's change, or holds it until the one on its way is answered; the menu shows
/// it at once.
fn send_set(s: &mut State, name: &str, value: &str) {
    if let Some(part) = s.view.as_mut().and_then(|o| o.part.as_mut())
        && let Some(x) = part.setting_mut(name)
    {
        let plain = value.is_empty() || x.default.as_deref() == Some(value);
        x.value = (!plain).then(|| value.to_string());
    }
    draft::refresh_menu(s);
    if s.setting {
        s.set_next = Some((name.to_string(), value.to_string()));
        return;
    }
    let Some(open) = &s.view else { return };
    let Some(line) = find(&s.edit.text, open.asked.line, &open.asked.text) else { return };
    let text = open.asked.text.clone();
    let p = json!({ "uri": s.uri, "line": line, "set": { "name": name, "value": value } });
    s.setting = true;
    draft::send(s, "rubric/part", What::Set, line, text, p);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(kind: &str, variant: Option<Variant>) -> Part {
        Part {
            name: "quote".into(),
            kind: kind.into(),
            variant,
            blocks: 3,
            settings: vec![
                Setting { name: "size".into(), values: vec!["normal".into(), "large".into()], default: Some("normal".into()), value: None },
                Setting { name: "cite".into(), ..Setting::default() },
            ],
            look: vec![Setting { name: "shadow".into(), values: vec!["none".into(), "soft".into(), "deep".into()], default: Some("none".into()), value: None }],
            close: Some(2),
        }
    }

    fn ids(part: &Part, view: &View) -> Vec<String> {
        rows(part, view, Some("Opus · low")).0.iter().filter(|r| r.takes_focus()).filter_map(|r| r.id().map(str::to_string)).collect()
    }

    fn changeable() -> View {
        View { of: Some("quote".into()), ..View::default() }
    }

    #[test]
    fn a_catalog_part_has_its_settings_look_words_change_and_remove() {
        assert_eq!(ids(&part("catalog", None), &changeable()), ["set:size", "set:cite", "set:shadow", "words", "change", "remove"]);
        assert_eq!(ids(&part("catalog", None), &View::default()), ["set:size", "set:cite", "set:shadow", "words", "remove"], "no Change… where the server offers none");
    }

    #[test]
    fn an_own_part_has_takes_reroll_every_site_and_remove_with_a_second_step() {
        let view = View { takes: 2, ..changeable() };
        assert_eq!(ids(&part("own", None), &view), ["set:size", "set:cite", "set:shadow", "words", "change", "takes", "reroll", "global", "remove-ask"]);
        let one = changeable();
        assert!(!ids(&part("own", None), &one).contains(&"takes".to_string()), "Takes from two");
    }

    #[test]
    fn a_variant_turns_every_line_on_or_off_and_goes_back() {
        let v = |everywhere| Some(Variant { of: "quote".into(), name: "torn-edge".into(), everywhere });
        let off = part("variant", v(false));
        assert_eq!(ids(&off, &changeable()), ["set:size", "set:cite", "set:shadow", "words", "change", "reroll", "everywhere", "plain", "remove-ask"]);
        let label = |p: &Part| rows(p, &changeable(), None).0.iter().find_map(|r| match r {
            Row::Item(i) if i.id == "everywhere" => Some(i.label.clone()),
            _ => None,
        }).unwrap();
        assert!(label(&off).ends_with("as torn-edge"));
        assert!(label(&part("variant", v(true))).ends_with("plain"));
    }

    fn label_of(part: &Part, view: &View, id: &str) -> String {
        rows(part, view, None).0.iter().find_map(|r| match r {
            Row::Item(i) if i.id == id => Some(i.label.clone()),
            _ => None,
        }).unwrap_or_else(|| panic!("no {id}"))
    }

    #[test]
    fn a_sites_own_part_is_headed_custom() {
        let r = rows(&part("own", None), &changeable(), None).0;
        assert!(matches!(&r[0], Row::Head { note, .. } if note == draft::CUSTOM), "{:?}", r[0]);
    }

    #[test]
    fn throwing_a_draft_away_and_going_back_to_the_catalogs_part_are_named_apart() {
        let drafting = View { status: Some("drafting".into()), new_variant: Some("quote".into()), ..changeable() };
        let new_line = draft::menu_rows(&View { status: Some("ready".into()), ..View::default() }, None, None).0;
        let cancel = new_line.iter().find_map(|r| match r {
            Row::Item(i) if i.id == "cancel" => Some(i.label.clone()),
            _ => None,
        }).unwrap();
        assert_eq!(label_of(&part("catalog", None), &drafting, "cancel"), cancel, "as a new: line's");
        let kept = part("variant", Some(Variant { of: "quote".into(), name: "torn-edge".into(), everywhere: false }));
        let plain = label_of(&kept, &changeable(), "plain");
        assert_ne!(plain, cancel);
        assert!(!plain.contains("quote"), "{plain}");
    }

    #[test]
    fn a_variant_drafting_or_ready_offers_the_drafts_rows_and_a_way_back() {
        let drafting = View { status: Some("drafting".into()), new_variant: Some("quote".into()), ..changeable() };
        assert_eq!(ids(&part("catalog", None), &drafting), ["stop", "cancel"]);
        let ready = View { status: Some("ready".into()), takes: 2, ..drafting };
        assert_eq!(ids(&part("catalog", None), &ready), ["keep", "reroll", "notes", "takes", "cancel"]);
    }

    #[test]
    fn a_choice_of_more_than_four_is_a_row_that_opens_its_values() {
        let mut p = part("catalog", None);
        p.settings[0].values = (0..6).map(|i| format!("v{i}")).collect();
        let r = rows(&p, &View::default(), None).0;
        assert!(matches!(&r[1], Row::Item(i) if i.more && i.id == "set:size"), "{:?}", r[1]);
    }

    #[test]
    fn the_words_after_a_lone_colon_are_found_outside_quotes() {
        assert_eq!(lead("::: quote size=large : bigger"), "::: quote size=large");
        assert_eq!(lead("::: quote cite=\"a : b\""), "::: quote cite=\"a : b\"");
        assert_eq!(lead("::: quote"), "::: quote");
        assert!(names_something("::: quote") && !names_something(":::") && !names_something("::: new: x") && !names_something("::: theme paper"));
    }

    #[test]
    fn unwrap_takes_the_line_and_its_closer_and_keeps_the_writing() {
        let text = "a\n::: quote\nWords.\n:::\nb";
        let mut e = TextEdit::new(text);
        unwrap(&mut e, 1, Some(3));
        assert_eq!(e.text, "a\nWords.\nb");
        e.undo();
        assert_eq!(e.text, text, "one undo");
        let mut e = TextEdit::new("::: divider\nb");
        unwrap(&mut e, 0, None);
        assert_eq!(e.text, "b");
        let mut e = TextEdit::new("a\n::: quote\nWords.\n:::");
        unwrap(&mut e, 1, Some(3));
        assert_eq!(e.text, "a\nWords.");
    }
}
