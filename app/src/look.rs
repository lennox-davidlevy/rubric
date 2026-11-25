//! The list of app themes in a panel (Ctrl+, or Cmd+,): moving draws the app in the theme
//! under the focus, Return keeps it, Esc goes back to the one before. And the routing of keys
//! to whatever panel is open.

use rune::{KeyEvent, Spring, Tx};

use crate::panel::{self, Item, Panel, Row, Taken};
use crate::state::{self, State};

pub const THEMES: &str = "themes";
const WIDTH: f32 = 250.0;

/// Opens the list with the theme drawn now under the focus.
pub fn open_themes(s: &mut State, tx: &mut Tx) {
    crate::draft::close(s);
    close_panels(s);
    show_themes(s);
    reveal(s, tx);
}

/// The list of themes as the only panel.
pub fn show_themes(s: &mut State) {
    let rows = s.look.themes.iter()
        .map(|e| {
            let item = Item::new(e.name.clone(), e.label()).check(e.name == s.look.name);
            Row::Item(if e.own { item.note("Own") } else { item })
        })
        .collect();
    let mut p = Panel::new(THEMES, "Themes", WIDTH, rows);
    p.focus(&s.look.name);
    s.theme_before = Some(s.look.name.clone());
    s.panels = vec![p];
}

/// The key of the element that draws a row.
pub fn row_key(panel: &str, row: &str) -> String {
    format!("row-{panel}-{row}")
}

/// Scrolls the row with the focus into its panel's view.
fn reveal(s: &State, tx: &mut Tx) {
    if let Some(p) = s.panels.last()
        && let Some(id) = p.active_id()
    {
        tx.scroll_into_view(row_key(&p.id, id));
    }
}

/// A key while a panel is open, and what the panel made of it (`Passed` with none open). From
/// the editor's key handler and from the panel's field.
pub fn key(s: &mut State, ev: &KeyEvent, tx: &mut Tx) -> Taken {
    let Some(top) = s.panels.last().map(|p| p.id.clone()) else { return Taken::Passed };
    // What a panel changes shows at once: the row lit, a theme drawn.
    tx.color_motion(Spring::NONE);
    let was_field = matches!(s.panels.last().and_then(Panel::row), Some(Row::Field { .. }));
    let taken = panel::key(&mut s.panels, ev, &s.field.text);
    act(s, &top, taken.clone(), tx);
    let in_field = matches!(s.panels.last().and_then(Panel::row), Some(Row::Field { .. }));
    if in_field && !was_field {
        tx.focus("panel-field", false);
    } else if was_field && !in_field {
        tx.focus("editor", false);
    }
    taken
}

/// What the panel `id` answered.
pub fn act(s: &mut State, id: &str, taken: Taken, tx: &mut Tx) {
    if taken == Taken::Moved {
        moved(s, id);
        reveal(s, tx);
        return;
    }
    if id == THEMES {
        themes(s, taken);
    }
}

/// The focus moved to another row of the panel `id`, by a key or the pointer.
fn moved(s: &mut State, id: &str) {
    if id == THEMES
        && let Some(name) = s.panels.last().and_then(|p| p.active_id()).map(str::to_string)
    {
        state::show_theme(s, &name);
    }
}

fn themes(s: &mut State, taken: Taken) {
    match taken {
        Taken::Chose(name) => {
            state::show_theme(s, &name);
            if let Err(e) = s.look.keep() {
                eprintln!("theme not kept: {e}");
            }
            s.theme_before = None;
            s.panels.clear();
        }
        Taken::Closed | Taken::Passed => restore(s),
        _ => {}
    }
}

/// The theme list closed without a choice: the theme before it comes back.
fn restore(s: &mut State) {
    if let Some(name) = s.theme_before.take() {
        state::show_theme(s, &name);
    }
}

/// Closes every panel as Esc would, its owner told.
pub fn close_panels(s: &mut State) {
    let Some(id) = s.panels.first().map(|p| p.id.clone()) else { return };
    s.panels.clear();
    if id == THEMES {
        restore(s);
    }
}

/// The pointer is over a row: it takes the focus, and the owner hears of it as a move.
pub fn hovered(s: &mut State, depth: usize, i: usize, tx: &mut Tx) {
    tx.color_motion(Spring::NONE);
    let Some(p) = s.panels.get_mut(depth) else { return };
    if p.active == i || !p.rows.get(i).is_some_and(Row::takes_focus) {
        return;
    }
    p.active = i;
    let id = p.id.clone();
    if depth + 1 == s.panels.len() {
        moved(s, &id);
    }
}

/// A press on a row: an item is chosen, a segment set.
pub fn pressed(s: &mut State, depth: usize, i: usize, segment: Option<usize>, tx: &mut Tx) {
    tx.color_motion(Spring::NONE);
    // A second panel open beside: a press on the first goes back to it.
    while s.panels.len() > depth + 1 {
        back(s, tx);
    }
    let Some(p) = s.panels.get_mut(depth) else { return };
    p.active = i;
    let id = p.id.clone();
    let taken = match (&mut p.rows[i], segment) {
        (Row::Item(item), _) => Taken::Chose(item.id.clone()),
        (Row::Seg { id, on, .. }, Some(n)) if *on != n => {
            *on = n;
            Taken::Set(id.clone(), n)
        }
        (Row::Field { .. }, _) => {
            tx.focus("panel-field", false);
            return;
        }
        _ => return,
    };
    act(s, &id, taken, tx);
}

/// The row back from a second panel drawn in the first's place.
pub fn back(s: &mut State, tx: &mut Tx) {
    if s.panels.len() > 1 {
        let id = s.panels.last().map(|p| p.id.clone()).unwrap_or_default();
        s.panels.pop();
        act(s, &id, Taken::Back, tx);
        tx.focus("editor", false);
    }
}
