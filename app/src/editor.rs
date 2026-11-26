//! The writing: the closing `:::` under a new opener, and the editor's keys.

use rune::{Key, KeyEvent, TextEdit, Tx};

use crate::state::State;

/// After `:::` alone on a line, typing a space puts `:::` on the line below at the same indent,
/// unless the `:::` already there is free to close it (Neovim's `close_directive`,
/// `editors/nvim/lua/rubric/init.lua`). Called from the field's key handler for a typed space,
/// so the space and the closer are one undo step; returns whether it typed the space.
pub fn closer(edit: &mut TextEdit) -> bool {
    let (a, b) = edit.range();
    if a != b {
        return false;
    }
    let row = edit.line_of_byte(a);
    let line = edit.line_range(row);
    let text = &edit.text[line.clone()];
    let indent = &text[..text.len() - text.trim_start_matches([' ', '\t']).len()];
    if a != line.end || &text[indent.len()..] != ":::" {
        return false;
    }
    let below = (line.end < edit.text.len()).then(|| &edit.text[edit.line_range(row + 1)]);
    let close = format!("{indent}:::");
    let add = below != Some(close.as_str()) || open_blocks(&edit.text, row) > 0;
    let typed = if add { format!(" \n{close}") } else { " ".to_string() };
    edit.undo_group(|e| {
        e.set_selection(a, a);
        e.insert(&typed);
        e.set_caret(a + 1);
    });
    true
}

/// How many blocks are open above line `row` (0-based, exclusive): each `:::` opener adds one
/// and each bare `:::` closes the innermost; code fences are skipped. The theme line opens
/// nothing. Neovim also skips parts that take nothing inside, which the server names in
/// `rubric/alone`; the slice ignores that notification, so such a line counts as an opener.
pub fn open_blocks(text: &str, row: usize) -> usize {
    let mut depth: usize = 0;
    let mut fence: Option<(u8, usize)> = None;
    for l in text.split('\n').take(row) {
        let t = l.trim_start_matches([' ', '\t']);
        let mark = fence_mark(t);
        if let Some((ch, n)) = fence {
            if let Some((c, m)) = mark && c == ch && m >= n && t.trim_end().bytes().all(|b| b == ch) {
                fence = None;
            }
        } else if mark.is_some() {
            fence = mark;
        } else if let Some(after) = colons(t) {
            let after = after.trim_start();
            if after.trim_end().is_empty() {
                depth = depth.saturating_sub(1);
            } else if !(after == "theme" || after.starts_with("theme ") || after.starts_with("theme\t")) {
                depth += 1;
            }
        }
    }
    depth
}

/// What follows three or more colons at the start of `t`.
fn colons(t: &str) -> Option<&str> {
    let n = t.bytes().take_while(|&b| b == b':').count();
    (n >= 3).then(|| &t[n..])
}

fn fence_mark(t: &str) -> Option<(u8, usize)> {
    let ch = *t.as_bytes().first()?;
    if ch != b'`' && ch != b'~' {
        return None;
    }
    let n = t.bytes().take_while(|&b| b == ch).count();
    (n >= 3).then_some((ch, n))
}

/// A panel's field: the panel's keys first, then the field's own editing.
pub fn field_key(s: &mut State, ev: &KeyEvent, tx: &mut Tx) -> bool {
    use crate::panel::Taken;
    // Keys reaching the field mean it has them, however it got them (a press on it).
    s.field_live = true;
    s.held = None;
    match crate::look::key(s, ev, tx) {
        Taken::Typing => false,
        // The panel closed; the key is not typed into a field that is gone.
        Taken::Passed => {
            tx.focus("editor", false);
            true
        }
        _ => true,
    }
}

/// The field's key handler, before focus navigation and the field's own editing. Tab is
/// always consumed, so focus never leaves the writing.
pub fn key(s: &mut State, ev: &KeyEvent, tx: &mut Tx) -> bool {
    // An open panel takes its keys first; any other key closes it and is the editor's.
    if crate::look::key(s, ev, tx) != crate::panel::Taken::Passed {
        return true;
    }
    if crate::look::themes_key(ev) {
        crate::look::open_themes(s, tx);
        return true;
    }
    // On a `new:` line, the status line's action has its key.
    if crate::draft::status_key(s, ev) {
        return true;
    }
    if ev.key == Key::Tab {
        crate::state::tab(s, tx);
        return true;
    }
    if ev.is_command('s') {
        crate::state::save(s);
        return true;
    }
    if !ev.mods.cmd && !ev.mods.ctrl && matches!(&ev.key, Key::Text(t) if t == " ") && closer(&mut s.edit) {
        crate::state::changed(s);
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at_end_of(text: &str, line: usize) -> TextEdit {
        let mut e = TextEdit::new(text);
        let r = e.line_range(line);
        e.set_caret(r.end);
        e
    }

    #[test]
    fn an_opener_on_an_empty_line_gets_a_closer_and_keeps_the_caret() {
        let mut e = at_end_of("a\n:::\nb", 1);
        assert!(closer(&mut e));
        assert_eq!(e.text, "a\n::: \n:::\nb");
        assert_eq!(e.range(), (6, 6), "the caret is after the space on the opener");
    }

    #[test]
    fn the_closer_keeps_the_indent() {
        let mut e = at_end_of("  :::", 0);
        assert!(closer(&mut e));
        assert_eq!(e.text, "  ::: \n  :::");
    }

    #[test]
    fn a_free_closer_below_is_used_and_none_is_added() {
        let mut e = at_end_of(":::\n:::", 0);
        assert!(closer(&mut e));
        assert_eq!(e.text, "::: \n:::");
    }

    #[test]
    fn inside_a_block_the_closer_below_is_that_blocks_so_another_is_added() {
        let mut e = at_end_of("::: quote\n:::\n:::", 1);
        assert!(closer(&mut e));
        assert_eq!(e.text, "::: quote\n::: \n:::\n:::");
    }

    #[test]
    fn no_closer_mid_line_or_after_words_or_with_a_selection() {
        for (text, caret) in [(":::", 1), ("::: a", 5), ("x :::", 5), ("::::", 4)] {
            let mut e = TextEdit::new(text);
            e.set_caret(caret);
            assert!(!closer(&mut e), "{text:?} at {caret}");
            assert_eq!(e.text, text);
        }
        let mut e = TextEdit::new(":::");
        e.set_selection(0, 3);
        assert!(!closer(&mut e));
    }

    #[test]
    fn one_undo_takes_back_the_space_and_the_closer() {
        let mut e = at_end_of("a\n:::", 1);
        assert!(closer(&mut e));
        e.undo();
        assert_eq!(e.text, "a\n:::");
    }

    #[test]
    fn open_blocks_skips_fences_and_the_theme_line() {
        assert_eq!(open_blocks("::: theme paper\n::: quote\n```\n:::\n```\n", 5), 1);
        assert_eq!(open_blocks("::: quote\n:::\n", 2), 0);
    }
}
