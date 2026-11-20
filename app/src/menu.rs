//! The menu at the caret: a title, rows, the keys that move in it, and where it goes. It takes
//! no focus; the editor's key handler hands it keys while it is open.

use rune::{Key, KeyEvent, Side};

#[derive(Clone, Debug, PartialEq)]
pub struct Menu {
    pub title: String,
    pub rows: Vec<Row>,
    pub active: usize,
    pub kind: Kind,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub id: String,
    pub label: String,
    pub note: Option<String>,
}

impl Row {
    pub fn new(id: &str, label: impl Into<String>) -> Row {
        Row { id: id.into(), label: label.into(), note: None }
    }
}

/// Which menu it is, which says what a row's id means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// The line's first menu, whatever its draft's status.
    New,
    Keep,
    Reroll,
    /// Parts near the words; the page draws the one looked at.
    Near,
    /// One line of notes for a reroll, typed in a field of its own (`State::notes`).
    Notes,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Taken {
    Moved,
    Chose(String),
    Closed,
    /// Not the menu's key: the menu closes and the editor takes it.
    Passed,
}

impl Menu {
    pub fn new(kind: Kind, title: impl Into<String>, rows: Vec<Row>) -> Menu {
        Menu { title: title.into(), rows, active: 0, kind }
    }
}

/// Up and Down move and stop at the ends; Return or Tab chooses; Esc closes; a key held with
/// a modifier (Shift+Up selects), or any other key, is the editor's.
pub fn key(menu: &mut Menu, ev: &KeyEvent) -> Taken {
    if ev.mods.cmd || ev.mods.ctrl || ev.mods.shift || ev.mods.alt {
        return Taken::Passed;
    }
    match ev.key {
        Key::Down => {
            menu.active = (menu.active + 1).min(menu.rows.len().saturating_sub(1));
            Taken::Moved
        }
        Key::Up => {
            menu.active = menu.active.saturating_sub(1);
            Taken::Moved
        }
        Key::Enter | Key::Tab => match menu.rows.get(menu.active) {
            Some(row) => Taken::Chose(row.id.clone()),
            None => Taken::Closed,
        },
        Key::Escape => Taken::Closed,
        _ => Taken::Passed,
    }
}

/// A row's height, the surface's padding, and the gap to the caret's line, in points.
pub const ROW: f32 = 28.0;
pub const PAD: f32 = 4.0;
pub const GAP: f32 = 4.0;
/// The menu's widest, and what it keeps clear of the pane's edges.
pub const WIDTH: f32 = 300.0;
pub const MARGIN: f32 = 8.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Place {
    /// Under the caret's line (`Side::Bottom`) or above it.
    pub side: Side,
    /// The menu's left edge.
    pub x: f32,
    /// The top of the line it hangs from: the caret's, or the pane's nearest edge when the
    /// caret's line is scrolled out of it.
    pub y: f32,
    pub width: f32,
}

/// Where a menu of `rows` rows (its title among them) goes for a caret at `[x, y, w, h]` in a
/// writing pane at `[x, y, w, h]`: under the caret's line, above it when there is no room
/// below, its left edge at the caret unless that would cross the pane's right edge, and never
/// wider than the pane less 16 points. The page is a native window over everything right of
/// the pane, so nothing of the menu may go there.
pub fn place(mut caret: [f32; 4], pane: [f32; 4], rows: usize) -> Place {
    caret[1] = caret[1].min(pane[1] + pane[3] - caret[3]).max(pane[1]);
    let width = WIDTH.min(pane[2] - 2.0 * MARGIN).max(0.0);
    let height = rows as f32 * ROW + 2.0 * PAD;
    let below = caret[1] + caret[3] + GAP + height <= pane[1] + pane[3] - MARGIN;
    let above = caret[1] - GAP - height >= pane[1] + MARGIN;
    let side = if below || !above { Side::Bottom } else { Side::Top };
    let x = caret[0].min(pane[0] + pane[2] - MARGIN - width).max(pane[0] + MARGIN);
    Place { side, x, y: caret[1], width }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune::Mods;

    fn menu() -> Menu {
        Menu::new(Kind::New, "New part", vec![Row::new("build", "Draft"), Row::new("cancel", "Cancel")])
    }

    fn press(m: &mut Menu, key: Key) -> Taken {
        key_of(m, KeyEvent { key, mods: Mods::default() })
    }

    fn key_of(m: &mut Menu, ev: KeyEvent) -> Taken {
        key(m, &ev)
    }

    #[test]
    fn down_and_up_move_and_stop_at_the_ends() {
        let mut m = menu();
        assert_eq!(press(&mut m, Key::Up), Taken::Moved);
        assert_eq!(m.active, 0);
        press(&mut m, Key::Down);
        assert_eq!(m.active, 1);
        press(&mut m, Key::Down);
        assert_eq!(m.active, 1);
        press(&mut m, Key::Up);
        assert_eq!(m.active, 0);
    }

    #[test]
    fn return_and_tab_choose_the_active_row() {
        let mut m = menu();
        assert_eq!(press(&mut m, Key::Enter), Taken::Chose("build".into()));
        press(&mut m, Key::Down);
        assert_eq!(press(&mut m, Key::Tab), Taken::Chose("cancel".into()));
    }

    #[test]
    fn esc_closes_and_other_keys_are_the_editors() {
        let mut m = menu();
        assert_eq!(press(&mut m, Key::Escape), Taken::Closed);
        assert_eq!(press(&mut m, Key::Text("x".into())), Taken::Passed);
        assert_eq!(press(&mut m, Key::Backspace), Taken::Passed);
        let save = KeyEvent { key: Key::Command('s'), mods: Mods { cmd: true, ..Mods::default() } };
        assert_eq!(key_of(&mut m, save), Taken::Passed);
        let select = KeyEvent { key: Key::Down, mods: Mods { shift: true, ..Mods::default() } };
        assert_eq!(key_of(&mut m, select), Taken::Passed);
        assert_eq!(m.active, 0);
    }

    const PANE: [f32; 4] = [0.0, 0.0, 500.0, 700.0];

    #[test]
    fn a_caret_scrolled_out_of_the_pane_hangs_the_menu_from_the_nearest_edge() {
        let below = place([100.0, 950.0, 2.0, 28.0], PANE, 3);
        assert_eq!((below.side, below.y), (Side::Top, 672.0));
        let above = place([100.0, -300.0, 2.0, 28.0], PANE, 3);
        assert_eq!((above.side, above.y), (Side::Bottom, 0.0));
    }

    #[test]
    fn under_the_caret_when_there_is_room() {
        let p = place([100.0, 200.0, 2.0, 28.0], PANE, 3);
        assert_eq!((p.side, p.x, p.width), (Side::Bottom, 100.0, WIDTH));
    }

    #[test]
    fn above_the_caret_near_the_bottom() {
        let p = place([100.0, 650.0, 2.0, 28.0], PANE, 3);
        assert_eq!(p.side, Side::Top);
    }

    #[test]
    fn inside_the_pane_at_its_right_edge_and_when_it_is_narrow() {
        let p = place([480.0, 200.0, 2.0, 28.0], PANE, 3);
        assert!(p.x + p.width <= 500.0 - MARGIN, "{p:?}");
        let narrow = [0.0, 0.0, 200.0, 700.0];
        let p = place([150.0, 200.0, 2.0, 28.0], narrow, 3);
        assert_eq!(p.width, 200.0 - 16.0);
        assert!(p.x >= MARGIN && p.x + p.width <= 200.0 - MARGIN, "{p:?}");
    }
}
