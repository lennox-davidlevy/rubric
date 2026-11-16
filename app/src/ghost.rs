//! The server's pick for a `:::` line, shown dimmed after the caret, and Tab taking it, as
//! Neovim's accept and `rubric.pin` do (`editors/nvim/lua/rubric/init.lua`).

use rune::TextEdit;
use serde_json::Value;

use crate::position;

#[derive(Clone, Debug, PartialEq)]
pub struct Pick {
    /// `insertText`, exactly as sent.
    pub show: String,
    /// `range.start`: line, UTF-16 column.
    pub at: (u32, u32),
    pub pin: Option<Pin>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pin {
    pub line: u32,
    pub text: String,
    /// False when the pin carries `build` or `change`, which open a menu in Neovim.
    pub acts: bool,
    /// The block's closer line, taken away with the empty lines inside it.
    pub drop: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Ghost {
    pub line: u32,
    pub version: i32,
    /// The first item only.
    pub pick: Pick,
}

/// The caret's line, when it is a `:::` line with words and the caret is at its end.
pub fn wants(text: &str, caret: usize) -> Option<u32> {
    let (line, _) = position::line_char(text, caret);
    let r = position::line_range(text, line);
    let l = &text[r.clone()];
    let t = l.trim_start_matches([' ', '\t']);
    let after = t.trim_start_matches(':');
    let words = t.len() - after.len() >= 3 && !after.trim().is_empty();
    (caret == r.end && words).then_some(line)
}

/// The first item of an `inlineCompletion` result (a list, or `{ items }`).
pub fn parse(result: &Value, line: u32, version: i32) -> Option<Ghost> {
    let items = result.get("items").unwrap_or(result).as_array()?;
    let item = items.first()?;
    let show = item.get("insertText")?.as_str()?.to_string();
    let start = item.get("range").and_then(|r| r.get("start"));
    let num = |v: Option<&Value>, k: &str| v.and_then(|v| v.get(k)).and_then(Value::as_u64).map(|n| n as u32);
    let at = (num(start, "line").unwrap_or(line), num(start, "character").unwrap_or(0));
    let pin = item.get("command").filter(|c| c.get("command").and_then(Value::as_str) == Some("rubric.pin"))
        .and_then(|c| c.get("arguments")?.get(0))
        .and_then(|a| {
            let flag = |k: &str| a.get(k).and_then(Value::as_bool).unwrap_or(false);
            Some(Pin {
                line: a.get("line")?.as_u64()? as u32,
                text: a.get("text")?.as_str()?.to_string(),
                acts: !flag("build") && !flag("change"),
                drop: a.get("drop").and_then(Value::as_u64).map(|n| n as u32),
            })
        });
    Some(Ghost { line, version, pick: Pick { show, at, pin } })
}

/// Inserts `show` at `at`, then carries out the pin: the whole line becomes its text, and with
/// `drop`, a closer below goes, with the empty lines inside the block. One undo step, built
/// from `set_selection` and `insert`, so one undo brings the words back. The caret ends at the
/// end of the line, or at the end of a starter body the pick brought.
pub fn accept(edit: &mut TextEdit, ghost: &Ghost) {
    let Some(pin) = &ghost.pick.pin else { return };
    edit.undo_group(|e| {
        let at = position::byte_at(&e.text, ghost.pick.at.0, ghost.pick.at.1);
        e.set_selection(at, at);
        e.insert(&ghost.pick.show);
        let mut caret = at + ghost.pick.show.len();

        let r = position::line_range(&e.text, pin.line);
        let caret_line = position::line_char(&e.text, caret).0;
        e.set_selection(r.start, r.end);
        e.insert(&pin.text);
        if caret_line == pin.line {
            caret = r.start + pin.text.len();
        } else if caret >= r.end {
            caret = caret + pin.text.len() - (r.end - r.start);
        }

        if let Some(drop) = pin.drop {
            let below = position::line_range(&e.text, drop);
            let closer = {
                let t = e.text[below.clone()].trim();
                t.len() >= 3 && t.bytes().all(|b| b == b':')
            };
            if closer && drop > pin.line && below.start < e.text.len() {
                let inside_start = position::line_range(&e.text, pin.line + 1).start;
                let empty = e.text[inside_start..below.start].trim().is_empty();
                let from = if empty { inside_start } else { below.start };
                // The lines go with their newline; the last line takes the one before it.
                let (cut_start, cut_end) = if below.end < e.text.len() { (from, below.end + 1) } else { (from - 1, below.end) };
                e.set_selection(cut_start, cut_end);
                e.insert("");
                if caret >= cut_end {
                    caret -= cut_end - cut_start;
                }
            }
        }
        e.set_caret(caret);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(show: &str, line: u32, ch: u32, pin: Value) -> Value {
        json!([{ "insertText": show, "range": { "start": { "line": line, "character": ch }, "end": { "line": line, "character": ch } }, "command": { "title": "Pin", "command": "rubric.pin", "arguments": [pin] } }])
    }

    #[test]
    fn wants_the_end_of_a_words_line_only() {
        assert_eq!(wants("a\n::: a quote\n:::", 13), Some(1));
        assert_eq!(wants("a\n::: a quote\n:::", 8), None, "mid-line");
        assert_eq!(wants("plain words", 11), None, "a plain line");
        assert_eq!(wants("a\n:::", 5), None, "a bare closer");
    }

    #[test]
    fn parse_reads_the_pin_or_none() {
        let g = parse(&item(" quote", 1, 11, json!({ "line": 1, "text": "::: quote" })), 1, 3).unwrap();
        assert_eq!(g.pick.show, " quote");
        assert_eq!(g.pick.at, (1, 11));
        assert_eq!(g.pick.pin, Some(Pin { line: 1, text: "::: quote".into(), acts: true, drop: None }));
        assert_eq!(g.version, 3);

        let built = parse(&item(" draft a new part", 1, 11, json!({ "line": 1, "text": "::: new: x", "build": true })), 1, 3).unwrap();
        assert!(!built.pick.pin.unwrap().acts);

        let bare = parse(&json!([{ "insertText": " x", "range": { "start": { "line": 0, "character": 3 } } }]), 0, 1).unwrap();
        assert_eq!(bare.pick.pin, None);

        assert_eq!(parse(&json!([]), 0, 1), None);
        assert_eq!(parse(&json!({ "items": [] }), 0, 1), None);
    }

    fn ghost(show: &str, at: (u32, u32), line: u32, text: &str, drop: Option<u32>) -> Ghost {
        Ghost { line, version: 1, pick: Pick { show: show.into(), at, pin: Some(Pin { line, text: text.into(), acts: true, drop }) } }
    }

    fn at_end(text: &str, line: u32) -> TextEdit {
        let mut e = TextEdit::new(text);
        e.set_caret(position::line_range(text, line).end);
        e
    }

    #[test]
    fn the_line_becomes_the_pin_and_others_stay() {
        let mut e = at_end("before\n::: a quote\n:::\nafter", 1);
        accept(&mut e, &ghost(" → quote", (1, 11), 1, "::: quote", None));
        assert_eq!(e.text, "before\n::: quote\n:::\nafter");
        assert_eq!(e.range(), (16, 16), "the caret at the end of the line");
    }

    #[test]
    fn a_starter_body_is_kept_and_the_caret_ends_after_it() {
        let mut e = at_end("::: some steps\n:::", 0);
        accept(&mut e, &ghost(" steps\n1. First", (0, 14), 0, "::: steps", None));
        assert_eq!(e.text, "::: steps\n1. First\n:::");
        assert_eq!(e.range(), (18, 18));
    }

    #[test]
    fn drop_takes_the_closer_and_the_empty_lines_inside() {
        let mut e = at_end("a\n::: a divider\n\n:::\nb", 1);
        accept(&mut e, &ghost(" divider", (1, 13), 1, "::: divider", Some(3)));
        assert_eq!(e.text, "a\n::: divider\nb");
    }

    #[test]
    fn drop_keeps_writing_inside_and_takes_only_the_closer() {
        let mut e = at_end("::: a divider\nkept\n:::", 0);
        accept(&mut e, &ghost(" divider", (0, 13), 0, "::: divider", Some(2)));
        assert_eq!(e.text, "::: divider\nkept");
    }

    #[test]
    fn drop_leaves_a_line_that_is_no_closer() {
        let mut e = at_end("::: a divider\n\ntext", 0);
        accept(&mut e, &ghost(" divider", (0, 13), 0, "::: divider", Some(2)));
        assert_eq!(e.text, "::: divider\n\ntext");
    }

    #[test]
    fn one_undo_brings_the_words_back() {
        let text = "a\n::: a divider\n\n:::\nb";
        let mut e = at_end(text, 1);
        accept(&mut e, &ghost(" divider", (1, 13), 1, "::: divider", Some(3)));
        e.undo();
        assert_eq!(e.text, text);
    }
}
