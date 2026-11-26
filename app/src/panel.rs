//! The app's panel: rows, controls and a field in one surface at a line of the writing, as the
//! design draws its menus (`RubricWindow.dc.html`, the `I`, `S`, `H`, `G`, `F`, `T` and `X`
//! rows). Plain data with no Rune in it but keys, so the tests need no window. Whoever opened a
//! panel acts on what `key` answers; `view` draws it.

use rune::{Key, KeyEvent};

/// A row's height in points, as the design's.
pub const ITEM: f32 = 30.0;
pub const SEP: f32 = 9.0;
pub const HEAD: f32 = 26.0;
pub const SEG: f32 = 32.0;
pub const FIELD: f32 = 36.0;
pub const TITLE: f32 = 28.0;
pub const TEXT: f32 = 40.0;
/// The surface's padding and border, the gap to the line, between two panels, and what a
/// panel keeps clear of the pane's edges.
pub const PAD: f32 = 4.0;
pub const BORDER: f32 = 1.0;
pub const GAP: f32 = 6.0;
pub const MARGIN: f32 = 8.0;

/// A key held with Cmd (Ctrl off the Mac), and Shift when `shift`, that chooses a row from
/// anywhere in its panel.
#[derive(Clone, Debug, PartialEq)]
pub struct Chord {
    pub key: Key,
    pub shift: bool,
}

impl Chord {
    pub fn cmd(key: Key) -> Chord {
        Chord { key, shift: false }
    }

    pub fn cmd_shift(key: Key) -> Chord {
        Chord { key, shift: true }
    }

    pub fn matches(&self, ev: &KeyEvent) -> bool {
        ev.mods.cmd && !ev.mods.alt && ev.mods.shift == self.shift && ev.key == self.key
    }

    /// "⌘↩" on the Mac, "Ctrl+Enter" elsewhere.
    pub fn label(&self) -> String {
        let mac = cfg!(target_os = "macos");
        let key = match &self.key {
            Key::Enter => if mac { "↩".to_string() } else { "Enter".to_string() },
            Key::Delete | Key::Backspace => if mac { "⌫".to_string() } else { "Delete".to_string() },
            Key::Command(c) => c.to_ascii_uppercase().to_string(),
            other => format!("{other:?}"),
        };
        match (mac, self.shift) {
            (true, false) => format!("⌘{key}"),
            (true, true) => format!("⇧⌘{key}"),
            (false, false) => format!("Ctrl+{key}"),
            (false, true) => format!("Ctrl+Shift+{key}"),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Item {
    pub id: String,
    pub label: String,
    /// Words after the label, in the second color.
    pub note: Option<String>,
    /// A small pill (the drafter, "Opus · low").
    pub chip: Option<String>,
    pub key: Option<Chord>,
    /// The one chosen.
    pub check: bool,
    /// Opens another panel.
    pub more: bool,
    /// Removes something: drawn in the failed color.
    pub danger: bool,
    /// Cannot be chosen: drawn dim, passed over by the keys and the pointer.
    pub off: bool,
}

impl Item {
    pub fn new(id: impl Into<String>, label: impl Into<String>) -> Item {
        Item { id: id.into(), label: label.into(), ..Item::default() }
    }
    pub fn note(mut self, n: impl Into<String>) -> Item {
        self.note = Some(n.into());
        self
    }
    pub fn chip(mut self, c: impl Into<String>) -> Item {
        self.chip = Some(c.into());
        self
    }
    pub fn key(mut self, k: Key) -> Item {
        self.key = Some(Chord::cmd(k));
        self
    }
    pub fn check(mut self, on: bool) -> Item {
        self.check = on;
        self
    }
    pub fn more(mut self) -> Item {
        self.more = true;
        self
    }
    pub fn danger(mut self) -> Item {
        self.danger = true;
        self
    }
    pub fn off(mut self) -> Item {
        self.off = true;
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Row {
    Item(Item),
    /// A hairline between groups.
    Sep,
    /// A group's name, and a note at its right.
    Head { name: String, note: String },
    /// A choice of a few: Left and Right change it.
    Seg { id: String, label: String, choices: Vec<String>, on: usize },
    /// A line of text, typed in `State::field` while it has the focus; `value` is what it
    /// shows otherwise, and what the field starts with.
    Field { id: String, label: Option<String>, placeholder: String, value: String },
    Title(String),
    Text(String),
}

impl Row {
    pub fn height(&self) -> f32 {
        match self {
            Row::Item(_) => ITEM,
            Row::Sep => SEP,
            Row::Head { .. } => HEAD,
            Row::Seg { .. } => SEG,
            Row::Field { .. } => FIELD,
            Row::Title(_) => TITLE,
            Row::Text(_) => TEXT,
        }
    }

    /// Rows the keys and the pointer stop on.
    pub fn takes_focus(&self) -> bool {
        match self {
            Row::Item(i) => !i.off,
            Row::Seg { .. } | Row::Field { .. } => true,
            _ => false,
        }
    }

    pub fn id(&self) -> Option<&str> {
        match self {
            Row::Item(i) => Some(&i.id),
            Row::Seg { id, .. } | Row::Field { id, .. } => Some(id),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Panel {
    /// What the panel is, for whoever acts on it.
    pub id: String,
    /// What a panel that replaces this one in a narrow pane shows as its way back.
    pub name: String,
    pub rows: Vec<Row>,
    /// The row with the focus: an index into `rows`.
    pub active: usize,
    pub width: f32,
    /// The row of the panel under it that opened this one.
    pub from: Option<usize>,
}

impl Panel {
    pub fn new(id: impl Into<String>, name: impl Into<String>, width: f32, rows: Vec<Row>) -> Panel {
        let active = rows.iter().position(Row::takes_focus).unwrap_or(0);
        Panel { id: id.into(), name: name.into(), rows, active, width, from: None }
    }

    /// The row with the focus, if it takes it.
    pub fn row(&self) -> Option<&Row> {
        self.rows.get(self.active).filter(|r| r.takes_focus())
    }

    /// Puts the focus on the row with `id`.
    pub fn focus(&mut self, id: &str) -> bool {
        match self.rows.iter().position(|r| r.takes_focus() && r.id() == Some(id)) {
            Some(i) => {
                self.active = i;
                true
            }
            None => false,
        }
    }

    pub fn active_id(&self) -> Option<&str> {
        self.row().and_then(Row::id)
    }

    /// The rows' heights, the padding and the border.
    pub fn height(&self) -> f32 {
        self.rows.iter().map(Row::height).sum::<f32>() + 2.0 * (PAD + BORDER)
    }

    /// The top of row `i`, from the panel's top.
    pub fn row_top(&self, i: usize) -> f32 {
        BORDER + PAD + self.rows.iter().take(i).map(Row::height).sum::<f32>()
    }

    fn step(&mut self, down: bool) -> bool {
        let found = if down {
            (self.active + 1..self.rows.len()).find(|&i| self.rows[i].takes_focus())
        } else {
            (0..self.active).rev().find(|&i| self.rows[i].takes_focus())
        };
        match found {
            Some(i) => {
                self.active = i;
                true
            }
            None => false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Taken {
    /// The focus moved to another row, or the key changed nothing and stays the panel's.
    Moved,
    Chose(String),
    /// A `Seg` took the choice at this index.
    Set(String, usize),
    /// Return in a field, with its text.
    Submitted(String, String),
    /// Esc on a second panel: it closed and the first has the focus.
    Back,
    Closed,
    /// Right on an item with a chip: the chip's panel.
    Chip(String),
    /// The field's own editing takes it.
    Typing,
    /// Not the panel's key: it closes and the editor takes it.
    Passed,
}

/// A key in the top panel of `stack`: Up and Down, and Tab and Shift+Tab, over the rows that
/// take the focus; Left and Right change a `Seg`; Return chooses an `Item` or submits a
/// `Field` (`text` is the field's); a row's own key chooses it from anywhere in the panel; Esc
/// goes back one panel, then closes; typing in a `Field` that is `live` (has the keys) stays
/// there; any other key closes the panels and is the editor's. Tab never chooses: it is the
/// key that opens a menu, and a second Tab must not act.
pub fn key(stack: &mut Vec<Panel>, ev: &KeyEvent, text: &str, live: bool) -> Taken {
    let depth = stack.len();
    let Some(panel) = stack.last_mut() else { return Taken::Passed };
    let in_field = live && matches!(panel.row(), Some(Row::Field { .. }));
    if ev.mods.cmd {
        let chosen = panel.rows.iter().find_map(|r| match r {
            Row::Item(i) if !i.off && i.key.as_ref().is_some_and(|k| k.matches(ev)) => Some(i.id.clone()),
            _ => None,
        });
        if let Some(id) = chosen {
            return Taken::Chose(id);
        }
        // Cut, copy, paste and select-all in a field are the field's.
        if in_field && matches!(&ev.key, Key::Command('a' | 'c' | 'v' | 'x' | 'z')) {
            return Taken::Typing;
        }
        stack.clear();
        return Taken::Passed;
    }
    match &ev.key {
        Key::Escape => {
            stack.pop();
            if stack.is_empty() { Taken::Closed } else { Taken::Back }
        }
        Key::Up | Key::Down if !ev.mods.shift => {
            panel.step(ev.key == Key::Down);
            Taken::Moved
        }
        Key::Tab => {
            panel.step(!ev.mods.shift);
            Taken::Moved
        }
        Key::Enter if !ev.mods.shift => match panel.row().cloned() {
            Some(Row::Item(i)) => Taken::Chose(i.id),
            Some(Row::Field { id, .. }) => Taken::Submitted(id, text.to_string()),
            _ => Taken::Moved,
        },
        Key::Left | Key::Right if !ev.mods.shift && !in_field => {
            let right = ev.key == Key::Right;
            match &mut panel.rows[panel.active] {
                Row::Seg { id, choices, on, .. } => {
                    let next = if right { (*on + 1).min(choices.len().saturating_sub(1)) } else { on.saturating_sub(1) };
                    if next == *on {
                        return Taken::Moved;
                    }
                    *on = next;
                    Taken::Set(id.clone(), next)
                }
                // Left on a second panel goes back to the first.
                _ if !right && depth > 1 => {
                    stack.pop();
                    Taken::Back
                }
                // Right on a row that opens another panel opens it.
                Row::Item(i) if right && i.more => Taken::Chose(i.id.clone()),
                // Right on a row with a chip opens the chip's panel.
                Row::Item(i) if right && i.chip.is_some() => Taken::Chip(i.id.clone()),
                // On a field without the keys: nothing to move in.
                Row::Field { .. } => Taken::Moved,
                _ => {
                    stack.clear();
                    Taken::Passed
                }
            }
        }
        _ if in_field => Taken::Typing,
        _ => {
            stack.clear();
            Taken::Passed
        }
    }
}

/// Where each shown panel goes, `[x, y, w, h]` in window points, and whether the second took
/// the first's place.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub rects: Vec<[f32; 4]>,
    /// The second panel is drawn where the first was, with a row back to it.
    pub replaced: bool,
}

/// A panel's place for a line at `line` (`[x, y, w, h]`, the caret's) in the writing pane
/// `pane`: under the line, or above it when it does not fit there, its left edge at the line's
/// unless that would cross the pane's right edge, as tall as the room allows (its rows scroll).
/// A second panel goes beside the first at the row that opened it; when the pane is too
/// narrow for both it takes the first's place. Nothing leaves the pane: the page is a native
/// window over everything right of it.
pub fn place(mut line: [f32; 4], pane: [f32; 4], stack: &[Panel]) -> Placed {
    let Some(first) = stack.first() else { return Placed { rects: Vec::new(), replaced: false } };
    let (left, top) = (pane[0] + MARGIN, pane[1] + MARGIN);
    let (right, bottom) = (pane[0] + pane[2] - MARGIN, pane[1] + pane[3] - MARGIN);
    // A line scrolled out of the pane hangs the panel from the pane's nearest edge.
    line[1] = line[1].min(pane[1] + pane[3] - line[3]).max(pane[1]);
    let fit = |w: f32| w.min(right - left).max(0.0);
    let x_at = |x: f32, w: f32| x.min(right - w).max(left);
    let w1 = fit(first.width);
    let x1 = x_at(line[0], w1);
    let (below, above) = (bottom - (line[1] + line[3] + GAP), line[1] - GAP - top);
    let h = first.height();
    let (y1, h1) = if h <= below || below >= above {
        (line[1] + line[3] + GAP, h.min(below.max(0.0)))
    } else {
        let h1 = h.min(above.max(0.0));
        (line[1] - GAP - h1, h1)
    };
    let mut rects = vec![[x1, y1, w1, h1]];
    let Some(second) = stack.get(1) else { return Placed { rects, replaced: false } };
    let w2 = fit(second.width);
    if x1 + w1 + GAP + w2 <= right {
        let at = second.from.map_or(0.0, |i| first.row_top(i) - BORDER - PAD);
        let h2 = second.height().min(bottom - top);
        let y2 = (y1 + at).min(bottom - h2).max(top);
        rects.push([x1 + w1 + GAP, y2, w2, h2]);
        return Placed { rects, replaced: false };
    }
    // Too narrow for both: the second, with a row back, where the first was.
    let h2 = (second.height() + ITEM).min(bottom - top);
    let y2 = if y1 + h2 <= bottom { y1 } else { (y1 + h1 - h2).max(top) };
    Placed { rects: vec![[x_at(x1, w2), y2, w2, h2]], replaced: true }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune::Mods;

    fn panel() -> Panel {
        Panel::new("p", "Part", 250.0, vec![
            Row::Title("Quote".into()),
            Row::Item(Item::new("keep", "Keep").key(Key::Enter)),
            Row::Sep,
            Row::Head { name: "Look".into(), note: String::new() },
            Row::Seg { id: "size".into(), label: "Size".into(), choices: vec!["Normal".into(), "Large".into()], on: 0 },
            Row::Field { id: "words".into(), label: None, placeholder: "words".into(), value: String::new() },
            Row::Item(Item::new("remove", "Remove").danger()),
        ])
    }

    fn ev(key: Key) -> KeyEvent {
        KeyEvent { key, mods: Mods::default() }
    }

    fn cmd(key: Key) -> KeyEvent {
        KeyEvent { key, mods: Mods { cmd: true, ..Mods::default() } }
    }

    fn active(s: &[Panel]) -> Option<String> {
        s.last().and_then(|p| p.active_id().map(str::to_string))
    }

    #[test]
    fn up_and_down_stop_only_on_rows_that_take_the_focus_and_at_the_ends() {
        let mut s = vec![panel()];
        assert_eq!(active(&s).as_deref(), Some("keep"), "the title is passed over");
        let order: Vec<_> = (0..5).map(|_| {
            key(&mut s, &ev(Key::Down), "", true);
            active(&s).unwrap()
        }).collect();
        assert_eq!(order, ["size", "words", "remove", "remove", "remove"]);
        for _ in 0..5 {
            key(&mut s, &ev(Key::Up), "", true);
        }
        assert_eq!(active(&s).as_deref(), Some("keep"));
    }

    #[test]
    fn tab_moves_as_down_and_shift_tab_as_up_and_neither_chooses() {
        let mut s = vec![panel()];
        assert_eq!(key(&mut s, &ev(Key::Tab), "", false), Taken::Moved);
        assert_eq!(active(&s).as_deref(), Some("size"));
        let back = KeyEvent { key: Key::Tab, mods: Mods { shift: true, ..Mods::default() } };
        assert_eq!(key(&mut s, &back, "", false), Taken::Moved);
        assert_eq!(key(&mut s, &back, "", false), Taken::Moved, "at the top it stays");
        assert_eq!(active(&s).as_deref(), Some("keep"));
        s[0].focus("words");
        assert_eq!(key(&mut s, &ev(Key::Tab), "typed", true), Taken::Moved, "a field with the keys is left");
        assert_eq!(active(&s).as_deref(), Some("remove"));
    }

    #[test]
    fn a_field_without_the_keys_takes_no_typing() {
        let mut s = vec![panel()];
        s[0].focus("words");
        assert_eq!(key(&mut s, &ev(Key::Left), "", false), Taken::Moved);
        assert_eq!(key(&mut s, &ev(Key::Down), "", false), Taken::Moved);
        assert_eq!(active(&s).as_deref(), Some("remove"));
    }

    #[test]
    fn an_item_that_is_off_takes_no_focus() {
        let mut s = vec![Panel::new("p", "P", 200.0, vec![
            Row::Item(Item::new("a", "A").off()),
            Row::Item(Item::new("b", "B")),
            Row::Item(Item::new("c", "C").off()),
        ])];
        assert_eq!(active(&s).as_deref(), Some("b"), "the first that can be chosen");
        key(&mut s, &ev(Key::Down), "", true);
        key(&mut s, &ev(Key::Up), "", true);
        assert_eq!(active(&s).as_deref(), Some("b"));
        assert!(!s[0].focus("c"));
    }

    #[test]
    fn left_and_right_change_a_seg_and_stop_at_its_ends() {
        let mut s = vec![panel()];
        s[0].focus("size");
        assert_eq!(key(&mut s, &ev(Key::Left), "", true), Taken::Moved);
        assert_eq!(key(&mut s, &ev(Key::Right), "", true), Taken::Set("size".into(), 1));
        assert_eq!(key(&mut s, &ev(Key::Right), "", true), Taken::Moved);
        assert!(matches!(&s[0].rows[4], Row::Seg { on: 1, .. }));
        assert_eq!(key(&mut s, &ev(Key::Left), "", true), Taken::Set("size".into(), 0));
    }

    #[test]
    fn return_chooses_an_item_and_submits_a_field() {
        let mut s = vec![panel()];
        assert_eq!(key(&mut s, &ev(Key::Enter), "", true), Taken::Chose("keep".into()));
        s[0].focus("words");
        assert_eq!(key(&mut s, &ev(Key::Enter), "torn edge", true), Taken::Submitted("words".into(), "torn edge".into()));
    }

    #[test]
    fn a_rows_own_key_chooses_it_from_another_row() {
        let mut s = vec![panel()];
        s[0].focus("remove");
        assert_eq!(key(&mut s, &cmd(Key::Enter), "", true), Taken::Chose("keep".into()));
        assert_eq!(s.len(), 1);
    }

    #[test]
    fn typing_in_a_field_stays_there_and_elsewhere_it_closes_the_panel() {
        let mut s = vec![panel()];
        s[0].focus("words");
        for k in [Key::Text("a".into()), Key::Backspace, Key::Left, Key::Right, Key::Home] {
            assert_eq!(key(&mut s, &ev(k), "", true), Taken::Typing);
        }
        assert_eq!(key(&mut s, &cmd(Key::Command('v')), "", true), Taken::Typing);
        s[0].focus("keep");
        assert_eq!(key(&mut s, &ev(Key::Text("a".into())), "", true), Taken::Passed);
        assert!(s.is_empty());
        let mut s = vec![panel()];
        assert_eq!(key(&mut s, &cmd(Key::Command('s')), "", true), Taken::Passed, "Ctrl+S is the editor's");
        assert!(s.is_empty());
    }

    #[test]
    fn esc_goes_back_one_panel_then_closes() {
        let mut s = vec![panel(), Panel::new("more", "More", 200.0, vec![Row::Item(Item::new("a", "A"))])];
        assert_eq!(key(&mut s, &ev(Key::Escape), "", true), Taken::Back);
        assert_eq!(s.len(), 1);
        assert_eq!(key(&mut s, &ev(Key::Escape), "", true), Taken::Closed);
        assert!(s.is_empty());
    }

    #[test]
    fn left_on_a_second_panel_goes_back_and_right_on_more_opens() {
        let more = Panel::new("first", "First", 200.0, vec![Row::Item(Item::new("plain", "Plain")), Row::Item(Item::new("deeper", "Deeper").more())]);
        let mut s = vec![more.clone(), Panel::new("second", "Second", 200.0, vec![Row::Item(Item::new("a", "A"))])];
        assert_eq!(key(&mut s, &ev(Key::Left), "", true), Taken::Back);
        assert_eq!(s.len(), 1);
        s[0].focus("deeper");
        assert_eq!(key(&mut s, &ev(Key::Right), "", true), Taken::Chose("deeper".into()));
        assert_eq!(s.len(), 1, "the owner opens what comes next");
    }

    const PANE: [f32; 4] = [0.0, 40.0, 700.0, 660.0];

    fn small() -> Panel {
        Panel::new("s", "Small", 250.0, vec![Row::Item(Item::new("a", "A")), Row::Item(Item::new("b", "B")), Row::Item(Item::new("c", "C"))])
    }

    fn inside(r: [f32; 4], pane: [f32; 4]) -> bool {
        r[0] >= pane[0] + MARGIN && r[1] >= pane[1] + MARGIN && r[0] + r[2] <= pane[0] + pane[2] - MARGIN + 0.01 && r[1] + r[3] <= pane[1] + pane[3] - MARGIN + 0.01
    }

    #[test]
    fn under_the_line_when_there_is_room_and_above_it_near_the_bottom() {
        let p = place([100.0, 200.0, 2.0, 29.0], PANE, &[small()]);
        assert_eq!(p.rects[0], [100.0, 235.0, 250.0, small().height()]);
        let p = place([100.0, 640.0, 2.0, 29.0], PANE, &[small()]);
        let r = p.rects[0];
        assert_eq!(r[1] + r[3], 640.0 - GAP, "ends just above the line");
        assert!(inside(r, PANE), "{r:?}");
    }

    #[test]
    fn a_panel_taller_than_the_room_is_cut_to_it() {
        let long = Panel::new("l", "Long", 250.0, (0..40).map(|i| Row::Item(Item::new(i.to_string(), "x"))).collect());
        let r = place([100.0, 300.0, 2.0, 29.0], PANE, &[long]).rects[0];
        assert!(r[3] < 40.0 * ITEM && inside(r, PANE), "{r:?}");
    }

    #[test]
    fn a_second_panel_goes_beside_the_first_at_its_row() {
        let mut second = small();
        second.from = Some(2);
        let p = place([20.0, 100.0, 2.0, 29.0], PANE, &[small(), second]);
        assert!(!p.replaced);
        let (a, b) = (p.rects[0], p.rects[1]);
        assert_eq!(b[0], a[0] + a[2] + GAP);
        assert_eq!(b[1], a[1] + 2.0 * ITEM, "level with the row that opened it");
        assert!(inside(b, PANE));
    }

    #[test]
    fn in_a_narrow_pane_the_second_takes_the_firsts_place() {
        let narrow = [0.0, 40.0, 380.0, 660.0];
        let mut second = small();
        second.from = Some(1);
        let first = place([20.0, 100.0, 2.0, 29.0], narrow, &[small()]).rects[0];
        let p = place([20.0, 100.0, 2.0, 29.0], narrow, &[small(), second.clone()]);
        assert!(p.replaced);
        assert_eq!(p.rects.len(), 1);
        let r = p.rects[0];
        assert_eq!((r[0], r[1]), (first[0], first[1]));
        assert_eq!(r[3], second.height() + ITEM, "with a row back");
        assert!(inside(r, narrow));
    }

    #[test]
    fn inside_the_pane_at_its_right_edge_and_when_it_is_narrower_than_the_panel() {
        let r = place([680.0, 100.0, 2.0, 29.0], PANE, &[small()]).rects[0];
        assert!(inside(r, PANE), "{r:?}");
        let tiny = [0.0, 40.0, 200.0, 660.0];
        let r = place([150.0, 100.0, 2.0, 29.0], tiny, &[small()]).rects[0];
        assert_eq!(r[2], 200.0 - 2.0 * MARGIN);
        assert!(inside(r, tiny), "{r:?}");
    }
}
