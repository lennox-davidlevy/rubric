//! The list of app themes in a panel (Ctrl+T or Ctrl+,; Cmd on the Mac): moving draws the app in the theme
//! under the focus, Return keeps it, Esc goes back to the one before. And the routing of keys
//! to whatever panel is open.

use rune::{Key, KeyEvent, Spring, Tx};

use crate::panel::{self, Item, Panel, Row, Taken};
use crate::state::{self, State};
use crate::theme::Mode;

pub const THEMES: &str = "themes";
/// The list's first row: light or dark.
pub const MODE: &str = "mode";
const WIDTH: f32 = 250.0;

/// The key that opens and closes the list of themes: Cmd+T or Cmd+, (Ctrl off the Mac).
pub fn themes_key(ev: &KeyEvent) -> bool {
    ev.is_command('t') || ev.is_command(',')
}

/// Opens the list with the theme drawn now under the focus.
pub fn open_themes(s: &mut State, tx: &mut Tx) {
    close_panels(s);
    show_themes(s);
    reveal(s, tx);
}

/// The list of themes as the only panel.
pub fn show_themes(s: &mut State) {
    let mode = Row::Seg {
        id: MODE.into(),
        label: "Mode".into(),
        choices: vec!["Light".into(), "Dark".into()],
        on: usize::from(s.look.mode == Mode::Dark),
    };
    let rows = std::iter::once(mode).chain(s.look.themes.iter().map(|e| {
        let item = Item::new(e.name.clone(), e.label()).check(e.name == s.look.name);
        Row::Item(if e.own { item.note("Own") } else { item })
    }));
    let mut p = Panel::new(THEMES, "Themes", WIDTH, rows.collect());
    p.focus(&s.look.name);
    s.theme_before = Some((s.look.name.clone(), s.look.mode));
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
    // The key that opens the list of themes closes it.
    if top == THEMES && themes_key(ev) {
        close_panels(s);
        return Taken::Closed;
    }
    // Return on the mode keeps the theme drawn, as on its row.
    if top == THEMES && ev.key == rune::Key::Enter && !ev.mods.cmd && !ev.mods.shift && !ev.mods.alt && s.panels.last().and_then(Panel::active_id) == Some(MODE) {
        let taken = Taken::Chose(s.look.name.clone());
        act(s, &top, taken.clone(), tx);
        return taken;
    }
    // A field row without the keys: typing on it, or Return, gives it the keys.
    if on_field(s) && !s.field_live && let Some(taken) = wake_field(s, ev, tx) {
        return taken;
    }
    let was_field = s.field_live;
    let peeking = s.panels.iter().any(|p| p.id == crate::draft::NEAR);
    let before = (s.panels.len(), s.panels.last().map(|p| p.active));
    let taken = panel::key(&mut s.panels, ev, &s.field.text, s.field_live);
    // A key that moved nothing (Down on the last row) tells no one.
    if taken == Taken::Moved && before == (s.panels.len(), s.panels.last().map(|p| p.active)) {
        return taken;
    }
    // A key that closed the panels closed the near list's look too.
    if s.panels.is_empty() && peeking && matches!(taken, Taken::Passed | Taken::Closed) {
        crate::draft::closed(s, true);
    } else {
        act(s, &top, taken.clone(), tx);
    }
    if taken != Taken::Typing {
        sync_field(s);
    }
    // Return in a field leaves it, as moving off it does.
    if matches!(taken, Taken::Submitted(..)) && s.field_live {
        s.field_live = false;
        hold(s);
    }
    follow(s, was_field, tx);
    taken
}

/// The field typed in is the top panel's row with the focus: a field taking the focus starts
/// from its row's value, and one left goes back to it. A field row reached by the keys or the
/// pointer does not have the keys until it is typed on, given Return or pressed: the writing
/// keeps them, so crossing a field moves no focus between two text inputs (which resets the
/// window's input method each time; see the findings).
pub fn sync_field(s: &mut State) {
    let at = s.panels.last().and_then(|p| match p.row() {
        Some(Row::Field { id, value, .. }) => Some(((p.id.clone(), id.clone()), value.clone())),
        _ => None,
    });
    match at {
        Some((key, value)) if s.field_of.as_ref() != Some(&key) => {
            s.field = rune::TextEdit::new(value);
            let end = s.field.text.len();
            s.field.set_caret(end);
            s.field_of = Some(key);
            s.field_live = false;
        }
        Some(_) => {}
        None => {
            s.field_of = None;
            s.field_live = false;
        }
    }
    hold(s);
}

/// While a field row without the keys has the focus, a copy of the writing as it is: text the
/// input method commits to the writing then goes to the field instead (`typed_on_field`).
fn hold(s: &mut State) {
    if on_field(s) && !s.field_live {
        if s.held.as_ref().is_none_or(|h| h.text != s.edit.text) {
            s.held = Some(s.edit.clone());
        }
    } else {
        s.held = None;
    }
}

/// The top panel's row with the focus is a field.
fn on_field(s: &State) -> bool {
    matches!(s.panels.last().and_then(Panel::row), Some(Row::Field { .. }))
}

/// The field gets the keys.
pub fn give_field(s: &mut State, tx: &mut Tx) {
    s.field_live = true;
    s.held = None;
    tx.focus("panel-field", false);
}

/// A key on a field row without the keys: a typed character, Backspace or Return gives the field
/// the keys, the character typed into it. None for any other key.
fn wake_field(s: &mut State, ev: &KeyEvent, tx: &mut Tx) -> Option<Taken> {
    if ev.mods.cmd || ev.mods.ctrl || ev.mods.alt {
        return None;
    }
    match &ev.key {
        Key::Text(t) => {
            s.field.insert(t);
            give_field(s, tx);
            crate::insert::typed(s, tx);
            Some(Taken::Typing)
        }
        Key::Backspace => {
            let end = s.field.text.len();
            if let Some(start) = s.field.text[..end].char_indices().next_back().map(|(i, _)| i) {
                s.field.set_selection(start, end);
                s.field.insert("");
            }
            give_field(s, tx);
            crate::insert::typed(s, tx);
            Some(Taken::Typing)
        }
        Key::Enter if !ev.mods.shift => {
            give_field(s, tx);
            Some(Taken::Moved)
        }
        _ => None,
    }
}

/// The writing changed while a field row without the keys had the focus: what the input method
/// committed was meant for the field. The writing goes back as it was, history and all, and the
/// text goes to the field, which gets the keys. False when the change was something else.
pub fn typed_on_field(s: &mut State, tx: &mut Tx) -> bool {
    if s.field_live || !on_field(s) {
        return false;
    }
    let Some(held) = s.held.take() else { return false };
    let (a, b) = held.range();
    let (was, now) = (&held.text, &s.edit.text);
    let tail = was.len() - b;
    let fits = now.len() >= a + tail && now.is_char_boundary(a) && now.is_char_boundary(now.len() - tail)
        && now[..a] == was[..a] && now[now.len() - tail..] == was[b..];
    if !fits {
        return false;
    }
    let typed = now[a..now.len() - tail].to_string();
    s.edit = held;
    s.field.insert(&typed);
    give_field(s, tx);
    crate::insert::typed(s, tx);
    true
}

/// A field that had the keys and is no longer the row with the focus gives them back to the
/// writing. Reaching a field gives it nothing.
fn follow(s: &mut State, was_field: bool, tx: &mut Tx) {
    if was_field && !(s.field_live && on_field(s)) {
        s.field_live = false;
        tx.focus("editor", false);
    }
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
    } else {
        crate::draft::act(s, id, taken, tx);
    }
}

/// The focus moved to another row of the panel `id`, by a key or the pointer.
fn moved(s: &mut State, id: &str) {
    if id == THEMES {
        if let Some(name) = s.panels.last().and_then(|p| p.active_id()).filter(|n| *n != MODE).map(str::to_string) {
            state::show_theme(s, &name);
        }
    } else {
        crate::draft::moved(s, id);
    }
}

fn themes(s: &mut State, taken: Taken) {
    match taken {
        Taken::Set(id, on) if id == MODE => {
            s.look.set_mode(if on == 1 { Mode::Dark } else { Mode::Light });
            s.spans = state::spans(s);
        }
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
    if let Some((name, mode)) = s.theme_before.take() {
        s.look.mode = mode;
        state::show_theme(s, &name);
    }
}

/// Closes every panel as Esc would, its owner told.
pub fn close_panels(s: &mut State) {
    // The next panel to open hangs from its own line.
    s.anchor = None;
    let Some(id) = s.panels.first().map(|p| p.id.clone()) else { return };
    let peeking = s.panels.iter().any(|p| p.id == crate::draft::NEAR);
    let looking = s.panels.iter().any(|p| p.id == crate::insert::LIST || p.id == crate::insert::SIMILAR);
    s.panels.clear();
    s.field_of = None;
    s.field_live = false;
    s.held = None;
    if id == THEMES {
        restore(s);
    } else if crate::insert::owns(&id) {
        crate::insert::closed(s, looking);
        crate::draft::closed(s, false);
    } else {
        crate::draft::closed(s, peeking);
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
        let was_field = s.field_live;
        moved(s, &id);
        sync_field(s);
        follow(s, was_field, tx);
    }
}

/// A press on a row: an item is chosen, a segment set.
pub fn pressed(s: &mut State, depth: usize, i: usize, segment: Option<usize>, tx: &mut Tx) {
    tx.color_motion(Spring::NONE);
    // A row that cannot be chosen does nothing.
    if !s.panels.get(depth).and_then(|p| p.rows.get(i)).is_some_and(Row::takes_focus) {
        return;
    }
    let was_field = s.field_live;
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
            sync_field(s);
            give_field(s, tx);
            return;
        }
        _ => return,
    };
    act(s, &id, taken, tx);
    sync_field(s);
    follow(s, was_field, tx);
    keys_home(s, tx);
}

/// After a press in a panel the keys go where they would after a key: the field that has them,
/// or the writing.
fn keys_home(s: &State, tx: &mut Tx) {
    if !s.field_live {
        tx.focus("editor", false);
    }
}

/// A press on an item's chip: the chip's panel.
pub fn chip_pressed(s: &mut State, depth: usize, i: usize, tx: &mut Tx) {
    tx.color_motion(Spring::NONE);
    while s.panels.len() > depth + 1 {
        back(s, tx);
    }
    let Some(p) = s.panels.get_mut(depth) else { return };
    let Some(Row::Item(item)) = p.rows.get(i) else { return };
    let (pid, iid) = (p.id.clone(), item.id.clone());
    p.active = i;
    act(s, &pid, Taken::Chip(iid), tx);
    keys_home(s, tx);
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
