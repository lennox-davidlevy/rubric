//! Putting a part on a line: Tab on an empty line opens the design's `insert` menu (Insert
//! part…, New part…, Cut, Copy, Paste); Insert part… is a field over the parts (`rubric/parts`),
//! grouped when it is empty, matched by name and description at once as the writer types, and
//! asked of the server after a pause only when nothing matches. On a `:::` line of words that
//! places no part, Tab opens `words-menu`: the best part, the others near the words, and Draft
//! new part.

use rune::{Key, KeyEvent, Mods, TextEdit, Tx};
use serde_json::{Value, json};

use crate::draft::{self, Asked, Open, View, What, readable};
use crate::panel::{Item, Panel, Row, Taken};
use crate::position;
use crate::state::{self, State};

pub const MENU: &str = "insert-menu";
pub const LIST: &str = "insert";
pub const NEW: &str = "new-part";
pub const WORDS: &str = "words-menu";
pub const SIMILAR: &str = "similar";
/// A group's parts, beside Insert part…'s list of groups.
pub const GROUP: &str = "insert-group";

/// How long after the last key the list is asked for again, in seconds.
pub const PAUSE: f64 = 0.25;

pub fn owns(id: &str) -> bool {
    matches!(id, MENU | LIST | NEW | WORDS | SIMILAR | GROUP)
}

/// A part to put on a line, from `rubric/parts`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Entry {
    pub name: String,
    pub description: String,
    pub own: bool,
    pub group: Option<String>,
    /// Takes nothing inside: no closer.
    pub empty: bool,
}

impl Entry {
    fn parse(v: &Value) -> Option<Entry> {
        Some(Entry {
            name: v.get("name")?.as_str()?.to_string(),
            description: v.get("description").and_then(Value::as_str).unwrap_or("").to_string(),
            own: v.get("own").and_then(Value::as_bool).unwrap_or(false),
            group: v.get("group").and_then(Value::as_str).map(str::to_string),
            empty: v.get("empty").and_then(Value::as_bool).unwrap_or(false),
        })
    }

    fn row(&self) -> Row {
        Row::Item(Item::new(format!("part:{}", self.name), readable(&self.name)).note(self.description.clone()))
    }
}

/// The line a menu of this module is for, and the parts it lists.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Insert {
    pub line: u32,
    /// The line as it read.
    pub text: String,
    /// Every part the site has, from the empty `rubric/parts` answer.
    pub all: Vec<Entry>,
    /// The words the list answers; the list shown.
    pub words: String,
    pub parts: Vec<Entry>,
    /// The words asked last: an answer for others is dropped.
    pub wanted: Option<String>,
    /// When the list is asked again, on the window's clock.
    pub due: Option<f64>,
}

/// Tab on an empty line: the menu to put a part there. False on any other line.
pub fn tab(s: &mut State) -> bool {
    let (line, text) = draft::caret_line(s);
    if !text.trim().is_empty() {
        return false;
    }
    let text = text.to_string();
    let selected = s.edit.range().0 != s.edit.range().1;
    let cmd = |c: char| Key::Command(c);
    let clip = |id: &str, label: &str, c: char, off: bool| {
        let i = Item::new(id, label).key(cmd(c));
        Row::Item(if off { i.off() } else { i })
    };
    let rows = vec![
        Row::Item(Item::new("insert", "Insert part…").more()),
        Row::Item(Item::new("new", "New part…").more()),
        Row::Sep,
        clip("cut", "Cut", 'x', !selected),
        clip("copy", "Copy", 'c', !selected),
        clip("paste", "Paste", 'v', false),
    ];
    crate::look::close_panels(s);
    s.insert = Some(Insert { line, text, ..Insert::default() });
    s.panels = vec![Panel::new(MENU, "Insert", 196.0, rows)];
    true
}

/// `rubric/part` said the caret's `:::` line places no part: the menu for its words.
pub fn words_menu(s: &mut State, asked: Asked) {
    let words = asked.text.trim_start().trim_start_matches(':').trim().to_string();
    if words.is_empty() {
        return;
    }
    s.insert = Some(Insert { line: asked.line, text: asked.text.clone(), wanted: Some(words.clone()), ..Insert::default() });
    // The line's drafts, for the drafter's chip.
    let view = View { words: words.clone(), drafter: s.drafter.clone(), ..View::default() };
    s.view = Some(Open { view, asked: Asked { what: What::Look, ..asked.clone() }, take_before: None, tools: None, offer: None, part: None });
    let p = json!({ "uri": s.uri, "words": words });
    draft::send(s, "rubric/parts", What::Parts, asked.line, words, p);
}

/// The parts for the words in `asked.text`.
pub fn parts_answered(s: &mut State, asked: Asked, answer: Value) {
    let parsed: Vec<Entry> = answer.get("parts").and_then(Value::as_array).map(|a| a.iter().filter_map(Entry::parse).collect()).unwrap_or_default();
    let is_list = s.panels.last().map(|p| p.id.as_str()) == Some(LIST);
    let Some(ins) = s.insert.as_mut() else { return };
    if is_list && asked.text.is_empty() {
        ins.all = parsed.clone();
        let q = s.field.text.trim().to_string();
        if q.is_empty() {
            ins.words.clear();
            ins.parts = parsed;
            ins.wanted = None;
            refresh_list(s);
        } else {
            let found = find(&ins.all, &q);
            if !found.is_empty() {
                ins.words = q;
                ins.parts = found;
                ins.due = None;
                ins.wanted = None;
                refresh_list(s);
            }
        }
        return;
    }
    if ins.wanted.as_deref() != Some(asked.text.as_str()) {
        return;
    }
    ins.words = asked.text.clone();
    ins.parts = parsed;
    match s.panels.last().map(|p| p.id.clone()).as_deref() {
        Some(LIST) => refresh_list(s),
        None if s.view.as_ref().is_some_and(|o| o.asked.text == s.insert.as_ref().unwrap().text) => {
            let ins = s.insert.as_ref().unwrap();
            let open = s.view.as_ref().unwrap();
            let chip = draft::chip(s, open);
            let mut rows = Vec::new();
            if let Some(best) = ins.parts.first() {
                rows.push(Row::Item(Item::new(format!("part:{}", best.name), readable(&best.name)).note(best.description.clone())));
            }
            if ins.parts.len() >= 2 {
                rows.push(Row::Item(Item::new("similar", format!("Similar parts ({})", ins.parts.len())).more()));
            }
            if !rows.is_empty() {
                rows.push(Row::Sep);
            }
            let draft = Item::new("draft", "Draft new part").key(Key::Enter);
            rows.push(Row::Item(match chip {
                Some(c) => draft.chip(c),
                None => draft,
            }));
            s.anchor = None;
            s.panels = vec![Panel::new(WORDS, readable(&ins.words), 300.0, rows)];
        }
        _ => {}
    }
}

/// Rebuilds the open `Insert part…` panel's rows from `s.insert`, keeping the field as typed.
fn refresh_list(s: &mut State) {
    if s.panels.last().map(|p| p.id.as_str()) != Some(LIST) {
        return;
    }
    let Some(ins) = s.insert.as_ref() else { return };
    let rows = list_rows(ins);
    let field = s.field.text.clone();
    let p = s.panels.last_mut().unwrap();
    p.rows = rows;
    if let Some(Row::Field { value, .. }) = p.rows.first_mut() {
        *value = field;
    }
    p.active = p.active.min(p.rows.len().saturating_sub(1));
    if !p.rows[p.active].takes_focus() {
        p.active = 0;
    }
}

/// Parts matching `query` by name or description, flat, preserving the server's order within each
/// tier: name starts with `query`, then name holds `query`, then a word of the description starts
/// with `query`. Both the readable name and the catalog's name are matched, case-insensitively.
pub fn find(parts: &[Entry], query: &str) -> Vec<Entry> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let mut starts = Vec::new();
    let mut holds = Vec::new();
    let mut desc = Vec::new();
    for e in parts {
        let name = e.name.to_lowercase();
        let nice = readable(&e.name).to_lowercase();
        if name.starts_with(&q) || nice.starts_with(&q) {
            starts.push(e.clone());
        } else if name.contains(&q) || nice.contains(&q) {
            holds.push(e.clone());
        } else if e.description.split(|c: char| !c.is_alphanumeric()).any(|w| !w.is_empty() && w.to_lowercase().starts_with(&q)) {
            desc.push(e.clone());
        }
    }
    starts.extend(holds);
    starts.extend(desc);
    starts
}

/// The parts by group: the site's own first, as Custom, then the catalog's groups in the order
/// the server lists them.
pub fn groups(parts: &[Entry]) -> Vec<(String, Vec<&Entry>)> {
    let own: Vec<&Entry> = parts.iter().filter(|e| e.own).collect();
    let mut groups: Vec<(String, Vec<&Entry>)> = Vec::new();
    if !own.is_empty() {
        groups.push((draft::CUSTOM.into(), own));
    }
    for e in parts.iter().filter(|e| !e.own) {
        let g = e.group.clone().unwrap_or_else(|| "Other".into());
        match groups.iter_mut().find(|(n, _)| *n == g) {
            Some((_, list)) => list.push(e),
            None => groups.push((g, vec![e])),
        }
    }
    groups
}

/// Insert part…'s rows: the field, then with no words each group with its count, which opens
/// its parts beside; with words the parts in Jev's order; and Draft new part.
pub fn list_rows(ins: &Insert) -> Vec<Row> {
    let mut rows = vec![Row::Field { id: "find".into(), label: None, placeholder: "Search parts".into(), value: ins.words.clone() }, Row::Sep];
    if ins.words.is_empty() {
        for (name, list) in groups(&ins.parts) {
            rows.push(Row::Item(Item::new(format!("group:{name}"), format!("{name} ({})", list.len())).more()));
        }
    } else {
        rows.extend(ins.parts.iter().map(Entry::row));
    }
    if !ins.parts.is_empty() {
        rows.push(Row::Sep);
    }
    let draft = Item::new("draft", "Draft new part").key(Key::Enter);
    rows.push(Row::Item(if ins.words.is_empty() { draft } else { draft.note(format!("“{}”", ins.words)) }));
    rows
}

/// The focus moved in a panel of this module: the page draws the part under it on the line.
pub fn moved(s: &mut State, id: &str) {
    if !matches!(id, LIST | SIMILAR | GROUP) {
        return;
    }
    let part = s.panels.last().and_then(Panel::active_id).and_then(|r| r.strip_prefix("part:")).map(str::to_string);
    peek(s, part.as_deref());
}

fn peek(s: &State, part: Option<&str>) {
    let (Some(c), Some(ins)) = (&s.client, &s.insert) else { return };
    let line = draft::find(&s.edit.text, ins.line, &ins.text).unwrap_or(ins.line);
    c.notify("rubric/peek", json!({ "uri": s.uri, "line": line, "part": part }));
}

/// A key in Insert part…'s field changed its text: match by name or description at once, and ask
/// the server after a pause only when nothing matches.
pub fn typed(s: &mut State, tx: &mut Tx) {
    if s.panels.last().map(|p| p.id.as_str()) != Some(LIST) {
        return;
    }
    let q = s.field.text.trim().to_string();
    let Some(ins) = &mut s.insert else { return };
    if q.is_empty() {
        ins.words.clear();
        ins.parts = ins.all.clone();
        ins.due = None;
        ins.wanted = None;
        refresh_list(s);
        return;
    }
    let found = find(&ins.all, &q);
    if !found.is_empty() {
        ins.words = q;
        ins.parts = found;
        ins.due = None;
        ins.wanted = None;
        refresh_list(s);
        return;
    }
    // Trailing whitespace on the same unfound words keeps what is already pending or shown.
    if ins.words == q && (ins.due.is_some() || ins.wanted.as_deref() == Some(q.as_str())) {
        refresh_list(s);
        return;
    }
    ins.words = q;
    ins.parts.clear();
    ins.wanted = None;
    ins.due = Some(tx.clock() + PAUSE);
    tx.wake_after(std::time::Duration::from_secs_f64(PAUSE));
    refresh_list(s);
}

/// At the start of each frame (`AppSpec::poll`): the list asked for once its pause is over.
pub fn poll(s: &mut State, clock: f64, tx: &mut Tx) -> bool {
    let Some(due) = s.insert.as_ref().and_then(|i| i.due) else { return false };
    if clock < due {
        tx.wake_after(std::time::Duration::from_secs_f64(due - clock));
        return false;
    }
    if let Some(ins) = &mut s.insert {
        ins.due = None;
    }
    ask_list(s, s.field.text.trim().to_string());
    true
}

fn ask_list(s: &mut State, words: String) {
    let Some(ins) = &mut s.insert else { return };
    if ins.wanted.as_deref() == Some(words.as_str()) {
        return;
    }
    ins.wanted = Some(words.clone());
    let line = ins.line;
    let p = if words.is_empty() { json!({ "uri": s.uri }) } else { json!({ "uri": s.uri, "words": words }) };
    draft::send(s, "rubric/parts", What::Parts, line, words, p);
}

/// What a panel of this module answered.
pub fn act(s: &mut State, id: &str, taken: Taken, tx: &mut Tx) {
    let Some(ins) = s.insert.clone() else { return };
    let Some(line) = draft::find(&s.edit.text, ins.line, &ins.text) else {
        return close(s, false);
    };
    match (id, taken) {
        (MENU, Taken::Chose(row)) => match row.as_str() {
            "insert" => {
                // The list takes the menu's place, so a group's parts open beside it.
                let rows = list_rows(&Insert { words: String::new(), ..ins.clone() });
                s.panels = vec![Panel::new(LIST, "Insert part", 320.0, rows).as_list()];
                ask_list(s, String::new());
            }
            "new" => {
                let rows = vec![
                    Row::Head { name: "New part".into(), note: String::new() },
                    Row::Field { id: "words".into(), label: None, placeholder: "What it is".into(), value: String::new() },
                ];
                draft::second(s, Panel::new(NEW, "New part", 280.0, rows), "new");
            }
            "cut" | "copy" | "paste" => {
                close(s, false);
                tx.focus("editor", false);
                let c = match row.as_str() {
                    "cut" => 'x',
                    "copy" => 'c',
                    _ => 'v',
                };
                tx.send_key(KeyEvent { key: Key::Command(c), mods: Mods { cmd: true, ..Mods::default() } });
            }
            _ => {}
        },
        (LIST, Taken::Chose(row)) if row.starts_with("group:") => {
            let name = &row["group:".len()..];
            let Some((_, list)) = groups(&ins.parts).into_iter().find(|(n, _)| n == name) else { return };
            let rows = std::iter::once(Row::Head { name: name.to_string(), note: String::new() })
                .chain(list.into_iter().map(Entry::row))
                .collect();
            draft::second(s, Panel::new(GROUP, name, 300.0, rows).as_list(), &row);
            moved(s, GROUP);
        }
        (LIST | SIMILAR | WORDS | GROUP, Taken::Chose(row)) if row.starts_with("part:") => {
            let Some(e) = ins.parts.iter().find(|e| row[5..] == e.name).cloned() else { return };
            close(s, true);
            place(&mut s.edit, line, &e);
            state::changed(s);
        }
        (LIST, Taken::Submitted(..)) => {
            // Return in the field: the first part listed for its words.
            if let Some(e) = ins.parts.first().cloned().filter(|_| !ins.words.is_empty() && ins.words == s.field.text.trim()) {
                close(s, true);
                place(&mut s.edit, line, &e);
                state::changed(s);
            }
        }
        (LIST, Taken::Chose(row)) if row == "draft" => {
            let words = s.field.text.trim().to_string();
            if !words.is_empty() {
                close(s, true);
                new_line(s, line, &words, true);
            }
        }
        (NEW, Taken::Submitted(_, words)) => {
            let words = words.trim().to_string();
            if words.is_empty() {
                return;
            }
            close(s, false);
            new_line(s, line, &words, false);
            // Its menu, as Tab on it opens it.
            draft::tab(s);
        }
        (WORDS, Taken::Chose(row)) => match row.as_str() {
            "similar" => {
                let rows = std::iter::once(Row::Head { name: "Similar parts".into(), note: ins.parts.len().to_string() })
                    .chain(ins.parts.iter().map(Entry::row))
                    .collect();
                draft::second(s, Panel::new(SIMILAR, "Similar parts", 264.0, rows).as_list(), "similar");
                moved(s, SIMILAR);
            }
            "draft" => {
                let words = ins.words.clone();
                let drafter = draft::choice_for(s, &ins.text).map(draft::Choice::json);
                close(s, false);
                let new = format!("{} new: {words}", opener(&ins.text));
                crate::part::set_line(&mut s.edit, line, &new);
                state::changed(s);
                let mut p = draft::params(Some("build"), &s.uri, line);
                if let Some(d) = drafter {
                    p["drafter"] = d;
                }
                draft::send(s, "rubric/draft", What::Build, line, new, p);
            }
            _ => {}
        },
        (WORDS, Taken::Chip(row)) => draft::act(s, draft::MENU, Taken::Chip(row), tx),
        (SIMILAR | GROUP, Taken::Back) => peek(s, None),
        (_, Taken::Closed | Taken::Passed) => close(s, matches!(id, LIST | SIMILAR | GROUP)),
        _ => {}
    }
}

/// The panels close; with `peeking`, the page draws the line as it is again.
fn close(s: &mut State, peeking: bool) {
    if peeking {
        peek(s, None);
    }
    s.panels.clear();
    s.insert = None;
    s.view = None;
}

/// The menu's line is let go (the panels closed some other way).
pub fn closed(s: &mut State, peeking: bool) {
    if peeking {
        peek(s, None);
    }
    s.insert = None;
}

/// The `:::` at the start of a line, with its indent, or `:::`.
fn opener(line: &str) -> String {
    let t = line.trim_start_matches([' ', '\t']);
    let colons = t.len() - t.trim_start_matches(':').len();
    if colons >= 3 { line[..line.len() - t.len() + colons].to_string() } else { ":::".into() }
}

/// The part on line `at`, one undo step: an empty line gets the part and its closer (none for
/// a part that takes nothing inside); a line of words becomes the part, and a closer right
/// under it goes when the part takes nothing inside. The caret ends on the part's line.
pub fn place(edit: &mut TextEdit, at: u32, e: &Entry) {
    let r = position::line_range(&edit.text, at);
    let line = edit.text[r.clone()].to_string();
    if line.trim().is_empty() {
        let indent = &line[..line.len() - line.trim_start().len()];
        let head = format!("{indent}::: {}", e.name);
        let new = if e.empty { head.clone() } else { format!("{head}\n{indent}:::") };
        edit.undo_group(|x| {
            x.set_selection(r.start, r.end);
            x.insert(&new);
            x.set_caret(r.start + head.len());
        });
        return;
    }
    let new = format!("{} {}", opener(&line), e.name);
    let asked = Asked { line: at, text: line, what: What::Act };
    let answer = if e.empty { json!({ "replace": new, "drop": at + 1 }) } else { json!({ "replace": new }) };
    draft::replace(edit, &asked, &answer);
}

/// Line `at` asks for a new part for `words` (and its closer, on an empty line); with `build`,
/// the draft starts.
fn new_line(s: &mut State, at: u32, words: &str, build: bool) {
    let r = position::line_range(&s.edit.text, at);
    let head = format!("::: new: {words}");
    let new = if s.edit.text[r.clone()].trim().is_empty() { format!("{head}\n:::") } else { head.clone() };
    s.edit.undo_group(|x| {
        x.set_selection(r.start, r.end);
        x.insert(&new);
        x.set_caret(r.start + head.len());
    });
    state::changed(s);
    if build {
        let p = draft::params(Some("build"), &s.uri, at);
        draft::send(s, "rubric/draft", What::Build, at, head, p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, own: bool, group: Option<&str>, empty: bool) -> Entry {
        Entry { name: name.into(), description: String::new(), own, group: group.map(str::to_string), empty }
    }

    #[test]
    fn with_no_words_the_list_is_its_groups_custom_first_each_opening_its_parts() {
        let ins = Insert {
            parts: vec![entry("tide-table", true, None, false), entry("steps", false, Some("Lists and steps"), false), entry("quote", false, Some("Writing"), false), entry("timeline", false, Some("Lists and steps"), false)],
            ..Insert::default()
        };
        let rows = list_rows(&ins);
        let items: Vec<&Item> = rows.iter().filter_map(|r| match r {
            Row::Item(i) => Some(i),
            _ => None,
        }).collect();
        let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, [format!("group:{}", draft::CUSTOM).as_str(), "group:Lists and steps", "group:Writing", "draft"]);
        assert!(items[..3].iter().all(|i| i.more), "a group opens its parts");
        assert!(items[1].label.contains('2'), "with its count: {}", items[1].label);
        let with_words = Insert { words: "steps".into(), ..ins };
        let ranked: Vec<String> = list_rows(&with_words).iter().filter_map(|r| r.id().map(str::to_string)).collect();
        assert_eq!(ranked, ["find", "part:tide-table", "part:steps", "part:quote", "part:timeline", "draft"], "a ranked list is flat");
    }

    #[test]
    fn a_part_on_an_empty_line_brings_its_closer_unless_it_takes_nothing() {
        let mut e = TextEdit::new("a\n\nb");
        place(&mut e, 1, &entry("quote", false, None, false));
        assert_eq!(e.text, "a\n::: quote\n:::\nb");
        assert_eq!(e.range(), (11, 11));
        e.undo();
        assert_eq!(e.text, "a\n\nb", "one undo");
        let mut e = TextEdit::new("a\n\nb");
        place(&mut e, 1, &entry("divider", false, None, true));
        assert_eq!(e.text, "a\n::: divider\nb");
    }

    fn entry_desc(name: &str, desc: &str, own: bool, group: Option<&str>) -> Entry {
        Entry { name: name.into(), description: desc.into(), own, group: group.map(str::to_string), empty: false }
    }

    #[test]
    fn find_orders_starts_then_holds_then_description_word_case_insensitively() {
        let parts = vec![
            entry_desc("tide-table", "A chart of tides.", true, None),
            entry_desc("callout", "A short note, such as a tip or a warning.", false, Some("Writing")),
            entry_desc("quote", "Words as said.", false, Some("Writing")),
            entry_desc("blockquote", "Another quote.", false, Some("Writing")),
            entry_desc("sidenote", "A warning in the margin, like a quote.", false, Some("Writing")),
        ];
        let names = |q: &str| -> Vec<String> { find(&parts, q).into_iter().map(|e| e.name).collect() };
        assert_eq!(names("QUO"), ["quote", "blockquote", "sidenote"]);
        assert_eq!(names("warning"), ["callout", "sidenote"]);
        assert_eq!(names("Tide t"), ["tide-table"]);
        assert_eq!(names("tide-t"), ["tide-table"]);
        assert!(names("numbered steps").is_empty());
    }

    #[test]
    fn a_line_of_words_becomes_the_part() {
        let mut e = TextEdit::new("::: three steps\n:::");
        place(&mut e, 0, &entry("steps", false, None, false));
        assert_eq!(e.text, "::: steps\n:::");
        let mut e = TextEdit::new("::: a line across\n:::\nb");
        place(&mut e, 0, &entry("divider", false, None, true));
        assert_eq!(e.text, "::: divider\nb");
    }
}
