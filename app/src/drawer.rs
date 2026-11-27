//! The site's drawer (Ctrl+O or the toolbar button): lists pages and posts from `rubric/pages`
//! over the left 300 points of the window, sliding in and out in 140 ms, and switches the open
//! document on Return or click.

use rune::{Cursor, Curve, Easing, Edge, El, Key, KeyEvent, ScrollSpec, Spring, TextStyle, Transition, Tx, col, el, row, text};
use serde_json::json;

use crate::state::{self, PageEntry, State};
use crate::{TITLE, fonts};

/// The drawer's width in window points (matches `toolbar::LEFT_COVER`).
pub const WIDTH: f32 = 300.0;

/// Slide duration in seconds (140 ms in and 140 ms out).
pub const SLIDE_SECS: f32 = 0.14;

/// State owned by the drawer across frames.
#[derive(Clone, Debug, Default)]
pub struct Drawer {
    pub open: bool,
    /// Index of the row with keyboard focus in `rows(s)`.
    pub selected: usize,
    /// URI of the selected row when the user moved with keys, to hold across a fresh `rubric/pages`.
    pub selected_uri: Option<String>,
    /// Index of the row under the pointer, if any.
    pub hovered: Option<usize>,
    /// Whether the user has moved the keyboard focus since the drawer opened.
    pub moved: bool,
}

/// The key of the element that draws selectable row `i`.
pub fn row_key(i: usize) -> String {
    format!("drawer-row-{i}")
}

/// Selectable rows in display order (Pages first, then Posts), preserving the server's order
/// within each section.
pub fn rows(s: &State) -> Vec<&PageEntry> {
    let Some(site) = &s.site_pages else { return Vec::new() };
    let pages = site.pages.iter().filter(|p| p.kind == "home" || p.kind == "page");
    let posts = site.pages.iter().filter(|p| p.kind == "post");
    pages.chain(posts).collect()
}

/// Index in `rows(s)` of the currently open document, or 0 if not listed.
pub fn open_index(s: &State) -> usize {
    if s.uri.is_empty() {
        return 0;
    }
    let open_uri = state::unescaped(&s.uri);
    rows(s).iter().position(|e| state::unescaped(&e.uri) == open_uri).unwrap_or(0)
}

/// Keeps `s.drawer.selected` valid after `rubric/pages` updates `s.site_pages`.
pub fn sync_selection(s: &mut State) {
    let uris: Vec<String> = rows(s).into_iter().map(|e| e.uri.clone()).collect();
    if uris.is_empty() {
        s.drawer.selected = 0;
        s.drawer.selected_uri = None;
        s.drawer.hovered = None;
        return;
    }
    if !s.drawer.moved {
        let idx = open_index(s);
        s.drawer.selected = idx;
        s.drawer.selected_uri = uris.get(idx).cloned();
    } else if let Some(uri) = &s.drawer.selected_uri {
        let target = state::unescaped(uri);
        if let Some(idx) = uris.iter().position(|u| state::unescaped(u) == target) {
            s.drawer.selected = idx;
        } else {
            s.drawer.selected = s.drawer.selected.min(uris.len() - 1);
            s.drawer.selected_uri = Some(uris[s.drawer.selected].clone());
        }
    } else {
        s.drawer.selected = s.drawer.selected.min(uris.len() - 1);
        s.drawer.selected_uri = Some(uris[s.drawer.selected].clone());
    }
    if s.drawer.hovered.is_some_and(|h| h >= uris.len()) {
        s.drawer.hovered = None;
    }
}

/// Opens the drawer: closes panels, asks `rubric/pages`, places keyboard focus on the open row,
/// yields 300 points from the page if needed (sliding the page over 140 ms), and blurs the
/// writing field.
pub fn open(s: &mut State, tx: &mut Tx) {
    tx.color_motion(Spring::NONE);
    let prev_cover = s.left_cover;
    s.view_slide.set(None);
    crate::look::close_panels(s);
    s.drawer.open = true;
    s.drawer.hovered = None;
    s.drawer.moved = false;
    sync_selection(s);
    crate::toolbar::sync_cover(s);
    state::begin_cover_slide(s, tx.scale(), false, prev_cover);
    tx.blur();
    if let Some(c) = &s.client {
        let id = c.request("rubric/pages", json!({}));
        s.pages_req = Some(id);
    }
    if !rows(s).is_empty() {
        tx.scroll_into_view_in("drawer-scroll", row_key(s.drawer.selected));
    }
}

/// Closes the drawer and returns keys to the writing when the writing pane is shown.
pub fn close(s: &mut State, tx: &mut Tx) {
    if !s.drawer.open {
        return;
    }
    tx.color_motion(Spring::NONE);
    let prev_cover = s.left_cover;
    s.view_slide.set(None);
    s.drawer.open = false;
    s.drawer.hovered = None;
    crate::toolbar::sync_cover(s);
    state::begin_cover_slide(s, tx.scale(), true, prev_cover);
    if s.split > 0.0 {
        tx.focus("editor", false);
    }
}

/// Toggles the drawer open or closed (Ctrl+O or the toolbar button).
pub fn toggle(s: &mut State, tx: &mut Tx) {
    if s.drawer.open {
        close(s, tx);
    } else {
        open(s, tx);
    }
}

/// Opens the row at `index` in `rows(s)` and closes the drawer.
pub fn open_row(s: &mut State, index: usize, tx: &mut Tx) {
    let uri = rows(s).get(index).map(|e| e.uri.clone());
    let Some(uri) = uri else {
        close(s, tx);
        return;
    };
    let Some(path) = state::uri_path(&uri) else {
        close(s, tx);
        return;
    };
    s.switched.set(Some(std::time::Instant::now()));
    let switched = state::switch_document(s, path, tx);
    if !switched {
        s.switched.set(None);
    }
    close(s, tx);
}

/// Handles every key while the drawer is open: Ctrl+O and Esc close it, Up and Down move, Return
/// opens the selected row, window shortcuts still work, and all other keys are consumed so typing
/// does nothing while the drawer is open.
pub fn key(s: &mut State, ev: &KeyEvent, tx: &mut Tx) -> bool {
    if !s.drawer.open {
        return false;
    }
    tx.color_motion(Spring::NONE);
    if let Some(sc) = crate::toolbar::shortcut(ev) {
        use crate::toolbar::Shortcut;
        return match sc {
            Shortcut::Drawer => {
                close(s, tx);
                true
            }
            Shortcut::CloseWindow
            | Shortcut::BothPanes
            | Shortcut::WritingOnly
            | Shortcut::PageOnly
            | Shortcut::OpenInBrowser
            | Shortcut::Save => crate::toolbar::key(s, ev, tx),
            Shortcut::ReloadPage if s.page_life.stopped => crate::toolbar::key(s, ev, tx),
            Shortcut::Themes | Shortcut::ThemesComma | Shortcut::ReloadPage => true,
        };
    }
    if ev.mods.cmd || ev.mods.ctrl || ev.mods.alt {
        return true;
    }
    match ev.key {
        Key::Escape => {
            close(s, tx);
        }
        Key::Up => {
            let len = rows(s).len();
            if len > 0 {
                let next = s.drawer.selected.saturating_sub(1);
                let uri = rows(s)[next].uri.clone();
                s.drawer.selected = next;
                s.drawer.selected_uri = Some(uri);
                s.drawer.moved = true;
                tx.scroll_into_view_in("drawer-scroll", row_key(next));
            }
        }
        Key::Down => {
            let len = rows(s).len();
            if len > 0 {
                let next = (s.drawer.selected + 1).min(len - 1);
                let uri = rows(s)[next].uri.clone();
                s.drawer.selected = next;
                s.drawer.selected_uri = Some(uri);
                s.drawer.moved = true;
                tx.scroll_into_view_in("drawer-scroll", row_key(next));
            }
        }
        Key::Enter => {
            let idx = s.drawer.selected;
            open_row(s, idx, tx);
        }
        _ => {}
    }
    true
}

/// The current Gregorian year in UTC (exact civil-from-days conversion, zero dependencies).
pub fn current_year() -> i32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    year_from_unix_days(secs.div_euclid(86_400))
}

/// Howard Hinnant's exact civil-from-days year calculation.
pub fn year_from_unix_days(days: i64) -> i32 {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (y + i64::from(m <= 2)) as i32
}

const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/// Formats `YYYY-MM-DD` as `12 June`, adding the year when it is not `this_year`.
pub fn format_date(iso: &str, this_year: i32) -> Option<String> {
    let mut parts = iso.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: usize = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let name = MONTHS[month - 1];
    if year == this_year {
        Some(format!("{day} {name}"))
    } else {
        Some(format!("{day} {name} {year}"))
    }
}

/// A post row's second line: formatted date, with ` · Draft` when `draft` is true.
pub fn post_sub(entry: &PageEntry, this_year: i32) -> Option<String> {
    if entry.kind != "post" {
        return None;
    }
    let date = entry.date.as_deref().and_then(|d| format_date(d, this_year));
    match (date, entry.draft) {
        (Some(d), true) => Some(format!("{d} · Draft")),
        (Some(d), false) => Some(d),
        (None, true) => Some("Draft".into()),
        (None, false) => None,
    }
}

/// The row label shown in the drawer: `Home` for `kind == "home"`, else the server's title.
pub fn row_label(entry: &PageEntry) -> &str {
    if entry.kind == "home" { "Home" } else { &entry.title }
}

/// The drawer overlay (a click-outside scrim below the toolbar, and the 300-point sliding drawer).
/// In page-only view the drawer sits in its final place under the sliding web view (and stays
/// mounted until the page finishes sliding back over it on close).
pub fn view(s: &State) -> Vec<El> {
    let held = !s.drawer.open && s.view_slide.get().is_some_and(|v| v.hold_drawer);
    if !s.drawer.open && !held {
        return Vec::new();
    }
    let under_page = s.split <= 0.0 || held;
    let p = s.look.palette;
    let kit = crate::kit(&p);
    let h = (s.height - TITLE).max(0.0);
    let this_year = current_year();
    let open_uri = (!s.uri.is_empty()).then(|| state::unescaped(&s.uri));

    let site_name = s.site_pages.as_ref().map(|sp| sp.site.as_str()).unwrap_or("");
    let header = row().key("drawer-site").w_full().py(6.0).px(10.0)
        .child(text(site_name.to_string()).font(TextStyle::new(14.0, 600.0)).color(p.ink).truncate().shrink());

    let mut list = col().w_full();
    if let Some(site) = &s.site_pages {
        let mut idx = 0usize;
        let pages: Vec<&PageEntry> = site.pages.iter().filter(|e| e.kind == "home" || e.kind == "page").collect();
        let posts: Vec<&PageEntry> = site.pages.iter().filter(|e| e.kind == "post").collect();

        if !pages.is_empty() {
            list = list.child(section_head("Pages", &p));
            for entry in pages {
                list = list.child(row_el(s, entry, idx, open_uri.as_deref(), None, &p));
                idx += 1;
            }
        }
        list = list.child(section_head("Posts", &p));
        if posts.is_empty() {
            list = list.child(
                row().key("drawer-no-posts").w_full().py(7.0).px(10.0)
                    .child(text("No posts").font(fonts::ui(400.0)).color(p.ink3)),
            );
        } else {
            for entry in posts {
                let sub = post_sub(entry, this_year);
                list = list.child(row_el(s, entry, idx, open_uri.as_deref(), sub, &p));
                idx += 1;
            }
        }
    }

    let viewport = col().w_full().grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).instant_changes().child(list);
    let scrolled = rune_kit::scroll_bar(&kit, "drawer-list", "drawer-scroll", viewport).w_full().grow(1.0).min_h(0.0);

    let mut drawer = col().key("drawer")
        .absolute(0.0, TITLE)
        .w(WIDTH)
        .h(h)
        .fill(p.pop)
        .border_sides([0.0, 1.0, 0.0, 0.0], p.line)
        .pt(14.0)
        .px(8.0)
        .pb(8.0)
        .child(header)
        .child(scrolled);

    if under_page {
        drawer = drawer.transition(Transition::none()).instant_changes();
    } else {
        drawer = drawer
            .transition(Transition::move_edge(Edge::Leading))
            .transition_motion(
                Curve::tween(SLIDE_SECS, Easing::EASE_OUT),
                Curve::tween(SLIDE_SECS, Easing::EASE_IN),
            );
    }

    if held {
        vec![drawer]
    } else {
        let scrim = el().key("drawer-scrim")
            .absolute(0.0, TITLE)
            .w(s.width)
            .h(h)
            .transition(Transition::none())
            .on_press_tx(|s: &mut State, tx| close(s, tx));
        vec![scrim, drawer]
    }
}

fn section_head(name: &str, p: &crate::theme::Palette) -> El {
    row().w_full().pt(14.0).px(10.0).pb(6.0)
        .child(text(name.to_string()).font(fonts::caption(400.0)).color(p.ink2))
}

fn row_el(
    s: &State,
    entry: &PageEntry,
    idx: usize,
    open_uri: Option<&[u8]>,
    sub: Option<String>,
    p: &crate::theme::Palette,
) -> El {
    let is_open = open_uri.is_some_and(|u| state::unescaped(&entry.uri) == u);
    let is_selected = s.drawer.selected == idx;
    let is_hovered = s.drawer.hovered == Some(idx);

    let bar = el().key(format!("drawer-open-{idx}")).w(2.0).radius(1.0)
        .fill(if is_open { p.accent } else { p.pop.alpha(0.0) });

    let mut content = col().grow(1.0).min_w(0.0).gap(1.0)
        .child(
            text(row_label(entry).to_string())
                .font(fonts::ui(if is_open { 600.0 } else { 400.0 }))
                .color(p.ink)
                .truncate()
                .shrink(),
        );
    if let Some(sub) = sub {
        content = content.child(text(sub).font(fonts::caption(400.0)).color(p.ink2).truncate().shrink());
    }

    let mut r = row().key(row_key(idx))
        .w_full()
        .py(7.0)
        .pr(10.0)
        .gap(8.0)
        .radius(6.0)
        .items_stretch()
        .fill(if is_hovered { p.hover } else { p.pop.alpha(0.0) })
        .cursor(Cursor::Pointer)
        .preserve_focus_on_press(true)
        .on_hover_change(move |s: &mut State, on, tx| {
            tx.color_motion(Spring::NONE);
            if on {
                s.drawer.hovered = Some(idx);
            } else if s.drawer.hovered == Some(idx) {
                s.drawer.hovered = None;
            }
        })
        .on_press_tx(move |s: &mut State, tx| open_row(s, idx, tx))
        .child(bar)
        .child(content);

    if is_selected {
        r = r.outline(1.5, -1.5, p.accent);
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_dates_with_year_only_when_not_this_year_and_adds_draft() {
        assert_eq!(format_date("2026-06-12", 2026).as_deref(), Some("12 June"));
        assert_eq!(format_date("2026-06-02", 2026).as_deref(), Some("2 June"));
        assert_eq!(format_date("2025-11-04", 2026).as_deref(), Some("4 November 2025"));
        assert_eq!(format_date("bad", 2026), None);
        assert_eq!(format_date("2026-13-01", 2026), None);

        let entry = |kind: &str, date: Option<&str>, draft: bool| PageEntry {
            uri: "file:///x.md".into(),
            kind: kind.into(),
            title: "Walk".into(),
            date: date.map(str::to_string),
            draft,
        };
        assert_eq!(post_sub(&entry("post", Some("2026-06-12"), true), 2026).as_deref(), Some("12 June · Draft"));
        assert_eq!(post_sub(&entry("post", Some("2026-06-12"), false), 2026).as_deref(), Some("12 June"));
        assert_eq!(post_sub(&entry("post", Some("2024-02-28"), true), 2026).as_deref(), Some("28 February 2024 · Draft"));
        assert_eq!(post_sub(&entry("post", None, true), 2026).as_deref(), Some("Draft"));
        assert_eq!(post_sub(&entry("post", None, false), 2026), None);
        assert_eq!(post_sub(&entry("page", Some("2026-06-12"), true), 2026), None);
        assert_eq!(post_sub(&entry("home", Some("2026-06-12"), false), 2026), None);
    }

    #[test]
    fn unix_days_to_year_handles_epoch_and_leap_boundaries() {
        // 1970-01-01 = day 0, 2000-02-29 = day 11016, 2026-11-27 = day 20784.
        assert_eq!(year_from_unix_days(0), 1970);
        assert_eq!(year_from_unix_days(11_016), 2000);
        assert_eq!(year_from_unix_days(20_453), 2025); // 2025-12-31
        assert_eq!(year_from_unix_days(20_454), 2026); // 2026-01-01
        assert_eq!(year_from_unix_days(20_784), 2026);
    }
}
