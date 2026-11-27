//! The toolbar row over both panes: drawer toggle, View popover, centered title and saved state,
//! Open in browser, and (on Linux) the close button and borderless window resize strips.

use rune::{Cursor, El, HelpLook, Icon, Key, KeyEvent, ResizeEdge, Side, Spring, Tx, el, icon, row, text};

use crate::panel::{self, Chord, Item, Panel, Row, Taken};
use crate::state::State;
use crate::theme::Palette;
use crate::{TITLE, fonts};

/// The View popover's panel id.
pub const VIEW: &str = "view";
/// The View popover's width in points.
pub const VIEW_WIDTH: f32 = 240.0;
/// Left column yielded by the page when the View popover (or drawer in sitting 3) is open.
pub const LEFT_COVER: f32 = 300.0;
/// The resize strip width at each edge and corner of the borderless Linux window, in points.
pub const EDGE: f32 = 4.0;
/// Window width at or below which the toolbar enters its narrow form (the design's 760 px).
pub const NARROW: f32 = 760.0;
/// Maximum title widths in wide and narrow windows, in points.
pub const TITLE_MAX: f32 = 520.0;
pub const TITLE_MIN: f32 = 300.0;

// The design's SVG icons (`reference/rubric-design/RubricWindow.dc.html`).
pub static DRAWER_ICON: Icon = Icon {
    name: "rubric-drawer",
    view: 16.0,
    body: r#"<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 2.6v10.8" fill="none" stroke="currentColor" stroke-width="1.2"/>"#,
};

pub static VIEW_ICON: Icon = Icon {
    name: "rubric-view",
    view: 16.0,
    body: r#"<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 2.6v10.8" fill="none" stroke="currentColor" stroke-width="1.2"/>"#,
};

pub static CHEVRON_ICON: Icon = Icon {
    name: "rubric-chevron",
    view: 8.0,
    body: r#"<path d="M1.5 3l2.5 2.5L6.5 3" fill="none" stroke="currentColor" stroke-width="1.2"/>"#,
};

pub static OPEN_ICON: Icon = Icon {
    name: "rubric-open-browser",
    view: 15.0,
    body: r#"<path d="M8.5 2.5h4v4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12.5 2.5L7 8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M11 9v3.5H2.5V4H6" fill="none" stroke="currentColor" stroke-width="1.2"/>"#,
};

pub static CLOSE_ICON: Icon = Icon {
    name: "rubric-close",
    view: 10.0,
    body: r#"<path d="M2 2l6 6M8 2L2 8" fill="none" stroke="currentColor" stroke-width="1.3"/>"#,
};

/// Which toolbar button the pointer is over.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hover {
    View,
    Open,
    Close,
}

/// Which panes are shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Panes {
    Both,
    Write,
    Page,
}

/// What the toolbar fits at a window width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub show_open: bool,
    pub title_max: f32,
}

/// Computes whether Open in browser fits and the widest the centered title can grow without
/// crossing any button.
pub fn layout(width: f32, linux: bool, has_saved: bool) -> Layout {
    // Left controls: 12 pad + 28 drawer + 4 gap + 40 view = 84; plus 12 breathing room.
    let left_clear = 96.0f32;
    // Right controls: 12 pad + (24 close + 14 gap on Linux) + 28 open; plus 12 breathing room.
    let right_open = if linux { 78.0 } else { 40.0 } + 12.0;
    let right_narrow = if linux { 36.0 } else { 12.0 } + 12.0;
    // Room reserved beside the title for the 10-point gap and the saved state word.
    let saved_reserve = if has_saved { 56.0 } else { 0.0 };
    let avail_open = (width - 2.0 * left_clear.max(right_open) - saved_reserve).max(0.0);
    let show_open = width > NARROW && avail_open >= TITLE_MIN;
    let title_max = if show_open {
        avail_open.min(TITLE_MAX)
    } else {
        let avail_narrow = (width - 2.0 * left_clear.max(right_narrow) - saved_reserve).max(0.0);
        avail_narrow.min(TITLE_MIN)
    };
    Layout { show_open, title_max }
}

/// Current pane arrangement from `s.split`.
pub fn panes(s: &State) -> Panes {
    if s.split >= 1.0 {
        Panes::Write
    } else if s.split <= 0.0 {
        Panes::Page
    } else {
        Panes::Both
    }
}

/// Switches panes, remembering the last non-edge split before hiding a pane.
pub fn set_panes(s: &mut State, mode: Panes, tx: &mut Tx) {
    if s.split > 0.0 && s.split < 1.0 {
        s.last_split = s.split;
    }
    crate::look::close_panels(s);
    match mode {
        Panes::Both => {
            if s.split <= 0.0 || s.split >= 1.0 {
                s.split = s.last_split.clamp(0.1, 0.9);
            }
            tx.focus("editor", false);
        }
        Panes::Write => {
            s.split = 1.0;
            tx.focus("editor", false);
        }
        Panes::Page => {
            s.split = 0.0;
        }
    }
}

/// Whether the View popover is open.
pub fn view_open(s: &State) -> bool {
    s.panels.first().is_some_and(|p| p.id == VIEW)
}

/// The View popover's rows: the three pane choices with their keys and a tick on the one shown;
/// when the toolbar is too narrow for Open in browser, it becomes the last item under a hairline.
pub fn view_panel(s: &State) -> Panel {
    let cur = panes(s);
    let mut rows = vec![
        Row::Item(Item::new("both", "Both panes").key(Key::Command('1')).check(cur == Panes::Both)),
        Row::Item(Item::new("write", "Writing only").key(Key::Command('2')).check(cur == Panes::Write)),
        Row::Item(Item::new("page", "Page only").key(Key::Command('3')).check(cur == Panes::Page)),
    ];
    let lay = layout(s.width, cfg!(target_os = "linux"), crate::state::clean(s));
    if !lay.show_open {
        let mut open = Item::new("open", "Open in browser");
        open.key = Some(Chord::cmd_shift(Key::Command('b')));
        if browser_url(s).is_none() {
            open = open.off();
        }
        rows.push(Row::Sep);
        rows.push(Row::Item(open));
    }
    let mut p = Panel::new(VIEW, "View", VIEW_WIDTH, rows);
    p.focus(match cur {
        Panes::Both => "both",
        Panes::Write => "write",
        Panes::Page => "page",
    });
    p
}

/// The View popover's rectangle `[x, y, w, h]`, hung from the View button.
pub fn view_rect(s: &State) -> [f32; 4] {
    let w = VIEW_WIDTH.min((s.width - 2.0 * panel::MARGIN).max(0.0));
    let raw_x = if s.view_btn_rect[2] > 0.0 { s.view_btn_rect[0] } else { 44.0 };
    let max_x = (s.width - panel::MARGIN - w).max(panel::MARGIN);
    let x = raw_x.min(max_x).max(panel::MARGIN);
    let h = s.panels.first().filter(|p| p.id == VIEW).map_or_else(|| view_panel(s).height(), Panel::height);
    let max_h = (s.height - TITLE - 4.0 - panel::MARGIN).max(0.0);
    [x, TITLE + 4.0, w, if max_h > 0.0 { h.min(max_h) } else { h }]
}

/// Keeps `s.left_cover` in sync with what is open at the left (at least 300 points while the View
/// popover is open).
pub fn sync_cover(s: &mut State) {
    s.left_cover = if view_open(s) {
        let r = view_rect(s);
        LEFT_COVER.max(r[0] + r[2])
    } else {
        0.0
    };
}

/// Opens or closes the View popover from the toolbar button.
pub fn toggle_view(s: &mut State, tx: &mut Tx) {
    tx.color_motion(Spring::NONE);
    if view_open(s) {
        crate::look::close_panels(s);
        if s.split > 0.0 {
            tx.focus("editor", false);
        }
    } else {
        crate::look::close_panels(s);
        s.panels = vec![view_panel(s)];
        sync_cover(s);
    }
}

/// Handles a choice or dismissal from the View popover.
pub fn act(s: &mut State, taken: Taken, tx: &mut Tx) {
    match taken {
        Taken::Chose(id) => match id.as_str() {
            "both" => set_panes(s, Panes::Both, tx),
            "write" => set_panes(s, Panes::Write, tx),
            "page" => set_panes(s, Panes::Page, tx),
            "open" => {
                crate::look::close_panels(s);
                open_in_browser(s, tx);
                if s.split > 0.0 {
                    tx.focus("editor", false);
                }
            }
            _ => {}
        },
        Taken::Closed | Taken::Passed => {
            crate::look::close_panels(s);
            if s.split > 0.0 {
                tx.focus("editor", false);
            }
        }
        _ => {}
    }
}

/// The full browser URL for the open post (`rubric/serving` + `rubric/page`), or `None` before
/// the server has reported a serving address.
pub fn browser_url(s: &State) -> Option<String> {
    let base = s.page_url.as_deref()?;
    match s.page_path.as_deref() {
        Some(path) if !path.is_empty() => {
            let root = base.trim_end_matches('/');
            if path.starts_with('/') {
                Some(format!("{root}{path}"))
            } else {
                Some(format!("{root}/{path}"))
            }
        }
        _ => Some(base.to_string()),
    }
}

/// Opens the post's live page in the system browser when the server address is known.
pub fn open_in_browser(s: &State, tx: &mut Tx) -> bool {
    let Some(url) = browser_url(s) else { return false };
    if let Err(e) = tx.open_url(&url) {
        eprintln!("open in browser failed: {e}");
    }
    true
}

/// Window-wide chords the app handles even while the page holds keys: Ctrl+1/2/3, Ctrl+Shift+B,
/// Ctrl+W, Ctrl+O, Ctrl+S, Ctrl+T, Ctrl+,, and Ctrl+Shift+R (Cmd on macOS).
pub fn window_chord(ev: &KeyEvent) -> bool {
    Chord::cmd(Key::Command('1')).matches(ev)
        || Chord::cmd(Key::Command('2')).matches(ev)
        || Chord::cmd(Key::Command('3')).matches(ev)
        || Chord::cmd_shift(Key::Command('b')).matches(ev)
        || Chord::cmd(Key::Command('w')).matches(ev)
        || Chord::cmd(Key::Command('o')).matches(ev)
        || Chord::cmd(Key::Command('s')).matches(ev)
        || Chord::cmd(Key::Command('t')).matches(ev)
        || Chord::cmd(Key::Command(',')).matches(ev)
        || Chord::cmd_shift(Key::Command('r')).matches(ev)
}

/// Window-wide toolbar shortcuts: Ctrl+1/2/3 for panes, Ctrl+Shift+B for Open in browser,
/// Ctrl+W to close the window.
pub fn key(s: &mut State, ev: &KeyEvent, tx: &mut Tx) -> bool {
    if Chord::cmd(Key::Command('1')).matches(ev) {
        set_panes(s, Panes::Both, tx);
        return true;
    }
    if Chord::cmd(Key::Command('2')).matches(ev) {
        set_panes(s, Panes::Write, tx);
        return true;
    }
    if Chord::cmd(Key::Command('3')).matches(ev) {
        set_panes(s, Panes::Page, tx);
        return true;
    }
    if Chord::cmd_shift(Key::Command('b')).matches(ev) {
        open_in_browser(s, tx);
        return true;
    }
    if Chord::cmd(Key::Command('w')).matches(ev) {
        tx.close_window();
        return true;
    }
    false
}

/// Tooltip look styled to the app's theme tokens: a 26-point box sitting inside the toolbar
/// beside its control, never under it over the page.
pub fn help_look(p: &Palette) -> HelpLook {
    HelpLook::system(false)
        .fill(p.pop)
        .ink(p.ink)
        .ring(1.0, p.line)
        .radius(6.0)
        .padding(9.0, 5.0)
        .font(fonts::caption(400.0))
        .keycaps(p.hover, p.ink2, fonts::key(), false)
        .keycap_shape(16.0, 5.0, 4.0, 4.0, 8.0)
        .gap(4.0)
        .delay(0.4)
}

fn hover_handler(which: Hover) -> impl Fn(&mut State, bool, &mut Tx) + 'static {
    move |s: &mut State, on: bool, tx: &mut Tx| {
        tx.color_motion(Spring::NONE);
        if on {
            s.toolbar_hover = Some(which);
        } else if s.toolbar_hover == Some(which) {
            s.toolbar_hover = None;
        }
    }
}

/// The 40-point toolbar row over both panes.
pub fn bar(s: &State) -> El {
    let p = s.look.palette;
    let linux = cfg!(target_os = "linux");
    let clean = crate::state::clean(s);
    let lay = layout(s.width, linux, clean);

    // Drawer button (28×26, radius 6). Dimmed and without hover until sitting 3 builds the drawer;
    // tip sits inside the toolbar to its right.
    let drawer_btn = row().key("toolbar-drawer").w(28.0).h(26.0).radius(6.0).center()
        .fill(p.bg.alpha(0.0))
        .no_window_drag()
        .preserve_focus_on_press(true)
        .help("Posts and pages")
        .help_keys([Chord::cmd(Key::Command('o')).label()])
        .help_side(Side::Right)
        .child(icon(&DRAWER_ICON, 16.0).color(p.ink3));

    // View button (height 26, 6 horizontal padding, icon + small chevron). Filled while hovered,
    // popover open, or one pane hidden. Tip sits inside the toolbar to its right.
    let view_on = s.toolbar_hover == Some(Hover::View) || view_open(s) || panes(s) != Panes::Both;
    let view_bg = if view_on { p.hover } else { p.bg.alpha(0.0) };
    let mut view_btn = row().key("toolbar-view").h(26.0).px(6.0).gap(4.0).radius(6.0).center_y()
        .fill(view_bg)
        .cursor(Cursor::Pointer)
        .no_window_drag()
        .preserve_focus_on_press(true)
        .on_hover_change(hover_handler(Hover::View))
        .on_layout(|s: &mut State, rect| {
            s.view_btn_rect = rect;
            if view_open(s) {
                sync_cover(s);
            }
        })
        .on_press_tx(|s: &mut State, tx| toggle_view(s, tx))
        .child(icon(&VIEW_ICON, 16.0).color(p.ink))
        .child(icon(&CHEVRON_ICON, 8.0).color(p.ink2));
    if !view_open(s) {
        view_btn = view_btn.help("View").help_side(Side::Right);
    }

    let left_group = row().key("toolbar-left").gap(4.0).center_y().no_window_drag()
        .child(drawer_btn)
        .child(view_btn);

    // Centered title and saved state, 10 points apart.
    let mut words = row().key("title-group").gap(10.0).items_end()
        .child(text(s.title.clone()).key("title").font(fonts::ui(500.0)).color(p.ink).max_w(lay.title_max).truncate().shrink());
    if clean {
        words = words.child(text("Saved").key("saved").font(fonts::caption(400.0)).color(p.ink2));
    }
    let center = row().key("title-center").absolute(0.0, 0.0).w_full().h_full().justify_center().center_y()
        .child(words);

    // Right controls: Open in browser (hidden when narrow, moves to View popover) and, 14 points
    // on, Linux close circle. Both tips sit inside the toolbar to their left.
    let mut right_group = row().key("toolbar-right").gap(14.0).center_y().no_window_drag();
    if lay.show_open {
        let ready = browser_url(s).is_some();
        let open_bg = if ready && s.toolbar_hover == Some(Hover::Open) { p.hover } else { p.bg.alpha(0.0) };
        let mut open_btn = row().key("toolbar-open").w(28.0).h(26.0).radius(6.0).center()
            .fill(open_bg)
            .no_window_drag()
            .preserve_focus_on_press(true)
            .help("Open in browser")
            .help_keys([Chord::cmd_shift(Key::Command('b')).label()])
            .help_side(Side::Left)
            .child(icon(&OPEN_ICON, 15.0).color(if ready { p.ink } else { p.ink3 }));
        if ready {
            open_btn = open_btn
                .cursor(Cursor::Pointer)
                .on_hover_change(hover_handler(Hover::Open))
                .on_press_tx(|s: &mut State, tx| {
                    open_in_browser(s, tx);
                });
        }
        right_group = right_group.child(open_btn);
    }
    if linux {
        let close_bg = if s.toolbar_hover == Some(Hover::Close) { p.line } else { p.hover };
        let close_btn = row().key("toolbar-close").w(24.0).h(24.0).radius(12.0).center()
            .fill(close_bg)
            .cursor(Cursor::Pointer)
            .no_window_drag()
            .preserve_focus_on_press(true)
            .on_hover_change(hover_handler(Hover::Close))
            .on_press_tx(|_: &mut State, tx| tx.close_window())
            .help("Close window")
            .help_keys([Chord::cmd(Key::Command('w')).label()])
            .help_side(Side::Left)
            .child(icon(&CLOSE_ICON, 10.0).color(p.ink));
        right_group = right_group.child(close_btn);
    }

    let mut bar = row().key("title-row").w_full().h(TITLE).px(12.0).center_y().fill(p.bg)
        .border_sides([0.0, 0.0, 1.0, 0.0], p.line)
        .window_drag();
    // Top and upper-side resize strips live under the toolbar's controls, above the row's drag band.
    if linux {
        let mid_w = (s.width - 2.0 * EDGE).max(0.0);
        let side_h = (TITLE - EDGE).max(0.0);
        bar = bar
            .child(el().key("resize-nw").absolute(0.0, 0.0).w(EDGE).h(EDGE).window_resize(ResizeEdge::NorthWest))
            .child(el().key("resize-n").absolute(EDGE, 0.0).w(mid_w).h(EDGE).window_resize(ResizeEdge::North))
            .child(el().key("resize-ne").absolute((s.width - EDGE).max(0.0), 0.0).w(EDGE).h(EDGE).window_resize(ResizeEdge::NorthEast))
            .child(el().key("resize-w-top").absolute(0.0, EDGE).w(EDGE).h(side_h).window_resize(ResizeEdge::West))
            .child(el().key("resize-e-top").absolute((s.width - EDGE).max(0.0), EDGE).w(EDGE).h(side_h).window_resize(ResizeEdge::East));
    }
    bar.child(center)
        .child(left_group)
        .child(el().grow(1.0))
        .child(right_group)
}

/// Side resize strips for the borderless Linux window, placed under `panes` so a divider snapped
/// to the left or right edge stays draggable.
pub fn window_side_resize_edges(s: &State) -> Vec<El> {
    if !cfg!(target_os = "linux") {
        return Vec::new();
    }
    let side_h = (s.height - TITLE - EDGE).max(0.0);
    let right_x = (s.width - EDGE).max(0.0);
    vec![
        el().key("resize-w").absolute(0.0, TITLE).w(EDGE).h(side_h).window_resize(ResizeEdge::West),
        el().key("resize-e").absolute(right_x, TITLE).w(EDGE).h(side_h).window_resize(ResizeEdge::East),
    ]
}

/// Bottom and lower-corner resize strips for the borderless Linux window, under panels/overlays.
pub fn window_bottom_resize_edges(s: &State) -> Vec<El> {
    if !cfg!(target_os = "linux") {
        return Vec::new();
    }
    let mid_w = (s.width - 2.0 * EDGE).max(0.0);
    let right_x = (s.width - EDGE).max(0.0);
    let bottom_y = (s.height - EDGE).max(0.0);
    vec![
        el().key("resize-sw").absolute(0.0, bottom_y).w(EDGE).h(EDGE).window_resize(ResizeEdge::SouthWest),
        el().key("resize-s").absolute(EDGE, bottom_y).w(mid_w).h(EDGE).window_resize(ResizeEdge::South),
        el().key("resize-se").absolute(right_x, bottom_y).w(EDGE).h(EDGE).window_resize(ResizeEdge::SouthEast),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn icons_rasterize_non_empty_pixels() {
        for ic in [&DRAWER_ICON, &VIEW_ICON, &CHEVRON_ICON, &OPEN_ICON, &CLOSE_ICON] {
            let px = rune::text::icon::icon_coverage(ic, 32);
            assert!(px.iter().any(|&a| a > 0), "{} produced empty coverage", ic.name);
        }
    }

    #[test]
    fn narrow_hides_open_in_browser_and_caps_title() {
        let wide = layout(1400.0, true, true);
        assert!(wide.show_open);
        assert_eq!(wide.title_max, TITLE_MAX);

        let mid = layout(760.0, true, true);
        assert!(!mid.show_open);
        assert_eq!(mid.title_max, TITLE_MIN);

        let tight = layout(420.0, true, true);
        assert!(!tight.show_open);
        assert!(tight.title_max < TITLE_MIN && tight.title_max > 0.0, "title shrinks before crossing buttons: {:?}", tight);
    }

    #[test]
    fn browser_url_joins_serving_root_and_page_path() {
        let mut s = State::open(PathBuf::from("/x/post.md"), String::new());
        assert_eq!(browser_url(&s), None);
        s.page_path = Some("/posts/long/".into());
        assert_eq!(browser_url(&s), None, "dimmed with no server address yet");
        s.page_url = Some("http://127.0.0.1:1415/".into());
        assert_eq!(browser_url(&s).as_deref(), Some("http://127.0.0.1:1415/posts/long/"));
        s.page_path = None;
        assert_eq!(browser_url(&s).as_deref(), Some("http://127.0.0.1:1415/"));
    }

    #[test]
    fn window_chord_matches_each_app_chord_and_leaves_page_keys_alone() {
        use rune::Mods;
        let cmd = |c: char| KeyEvent { key: Key::Command(c), mods: Mods { cmd: true, ctrl: true, ..Mods::default() } };
        let cmd_shift = |c: char| KeyEvent { key: Key::Command(c), mods: Mods { cmd: true, ctrl: true, shift: true, ..Mods::default() } };

        for ev in [
            cmd('1'), cmd('2'), cmd('3'), cmd_shift('b'), cmd('w'),
            cmd('o'), cmd('s'), cmd('t'), cmd(','), cmd_shift('r'),
        ] {
            assert!(window_chord(&ev), "expected window_chord for {ev:?}");
        }

        for ev in [
            cmd('c'),
            cmd('a'),
            cmd('v'),
            cmd('b'),
            cmd('r'),
            cmd_shift('1'),
            KeyEvent { key: Key::Command('1'), mods: Mods { cmd: true, ctrl: true, alt: true, ..Mods::default() } },
            KeyEvent { key: Key::Text("a".into()), mods: Mods::default() },
            KeyEvent { key: Key::Text(" ".into()), mods: Mods::default() },
            KeyEvent { key: Key::Down, mods: Mods::default() },
        ] {
            assert!(!window_chord(&ev), "unexpected window_chord for {ev:?}");
        }
    }
}
