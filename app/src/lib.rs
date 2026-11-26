//! Rubric's app: the writing beside the page, on Rune.

pub mod draft;
pub mod editor;
pub mod fonts;
pub mod ghost;
pub mod insert;
pub mod look;
pub mod lsp;
pub mod markdown;
pub mod page;
pub mod panel;
pub mod part;
pub mod position;
pub mod split;
pub mod state;
pub mod theme;

use rune::{Cursor, Cx, Effect, El, Phase, ScrollSpec, Spring, SpringPair, Transition, col, el, row, text, text_input};
use rune_kit::{Kit, PaletteSeed, popover};

use panel::{Item, Panel, Row};

use state::State;
use theme::Palette;

/// The writing column's widest, in points: the design's 540 and the pane's padding.
pub const COLUMN: f32 = 540.0 + 2.0 * PAD;
/// The writing pane's padding at the sides, and the column's top.
const PAD: f32 = 24.0;
const TOP: f32 = 56.0;

/// The divider's width, in points.
pub const DIVIDER: f32 = 6.0;

/// The title row's height, in points.
pub const TITLE: f32 = 40.0;

/// The status line's height, under the writing.
pub const STATUS: f32 = 34.0;

/// Rune's kit, colored from the app's theme, for what the kit draws (the panels' surface).
pub fn kit(p: &Palette) -> Kit {
    let mut k = Kit::from_palette(PaletteSeed { bg: p.pop, fg: p.ink, accent: p.accent });
    k.c.surface_raised = p.pop;
    k.c.text_base = p.ink;
    k.c.text_strong = p.ink;
    k.c.text_weak = p.ink2;
    k.c.text_muted = p.ink2;
    k.c.text_faint = p.ink3;
    k.c.hover = p.hover;
    k.c.border_base = p.line;
    k
}

pub fn view(s: &State, cx: &mut Cx<State>) -> El {
    let p = s.look.palette;
    let scale = cx.env().scale;
    let room = (s.width - DIVIDER).max(0.0);
    let left = (room * s.split).round();
    // A hairline in the middle of a wider grip.
    let divider = row().key("divider").w(DIVIDER).h_full().fill(p.bg).justify_center().cursor(Cursor::ResizeColumn)
        .child(el().w(1.0).h_full().fill(p.line))
        .on_drag(|s: &mut State, d, tx| {
            if d.phase == Phase::Down {
                d.data = s.split;
            }
            s.split = split::dragged(d.data, d.dx, (s.width - DIVIDER).max(1.0));
            // At the left edge the writing is 0 wide and loses focus; when it shows again,
            // typing goes back to it.
            if d.phase == Phase::Up && s.split > 0.0 {
                tx.focus("editor", false);
            }
        });
    let page = el().key("page").w(room - left).h_full().fill(p.bg)
        .on_layout(move |s: &mut State, rect| state::page_laid_out(s, rect, scale));
    let panes = row().key("panes").w_full().grow(1.0).min_h(0.0)
        .child(writing(s).w(left))
        .child(divider)
        .child(page);
    let mut window = col().key("window").w_full().h_full().fill(p.bg)
        .on_layout(|s: &mut State, rect| {
            s.width = rect[2];
            s.height = rect[3];
        })
        .child(title_row(s))
        .child(panes);
    // The pick, dimmed, right after the caret; the caret is read only while there is one, so
    // the view does not re-run on every caret move.
    if let Some(g) = state::showing(s)
        && let Some([x, y, w, _]) = cx.caret("editor")
    {
        window = window.child(
            text(g.pick.show.clone()).key("ghost").font(fonts::writing()).color(p.ink3).absolute(x + w, y),
        );
    }
    let mut layer = Vec::new();
    // The panels, from the caret's line, in the layer above the window's.
    if !s.panels.is_empty() {
        // Before anything was laid out, the top of the column.
        let start = [s.pane[0] + PAD, s.pane[1] + TOP, 1.0, fonts::LINE];
        let line = cx.caret("editor").or(s.panel_at).unwrap_or(start);
        window = window.child(
            el().key("panel-anchor").absolute(line[0], line[1]).w(1.0).h(line[3])
                .on_layout(|s: &mut State, rect| s.panel_at = Some(rect)),
        );
        let placed = panel::place(line, s.pane, &s.panels);
        let shown = if placed.replaced { &s.panels[1..] } else { &s.panels[..] };
        let first = usize::from(placed.replaced);
        for (n, (p, rect)) in shown.iter().zip(&placed.rects).enumerate() {
            let back = (placed.replaced && n == 0).then(|| s.panels[0].name.as_str());
            layer.push(panel_view(s, p, first + n, *rect, back));
        }
    }
    rune_kit::root(window, layer)
}

/// The design's spring for menus: fade, and scale from 0.98; a 60 ms fade out.
fn opening() -> Transition {
    Transition {
        insertion: Effect::opacity(0.0).combined(Effect::scale(0.98)),
        removal: Effect::opacity(0.0),
        springs: SpringPair::new(Spring::from_stiffness_damping(700.0, 50.0, 1.0), Spring::new(0.06, 0.0)),
        ..Transition::identity()
    }
}

/// One panel at `rect`; `back` names the panel it replaced, drawn as a first row that goes back.
fn panel_view(s: &State, p: &Panel, depth: usize, rect: [f32; 4], back: Option<&str>) -> El {
    let c = s.look.palette;
    let mut rows = col().w_full();
    if let Some(name) = back {
        rows = rows.child(
            row().key("panel-back").w_full().h(panel::ITEM).pl(10.0).pr(8.0).gap(8.0).center_y().radius(5.0)
                .child(text(format!("‹ {name}")).font(fonts::ui(400.0)).color(c.ink2))
                .on_press_tx(|s: &mut State, tx| look::back(s, tx)),
        );
    }
    for (i, r) in p.rows.iter().enumerate() {
        rows = rows.child(row_view(s, p, depth, i, r));
    }
    let inner = rect[3] - 2.0 * (panel::PAD + panel::BORDER);
    let body = col().w_full().h(inner).min_h(0.0).child(popover::fit_scroll(rows));
    let kit = kit(&c);
    popover::raised(&kit, col().key(format!("panel-{depth}")).padding(panel::PAD).child(body), 8.0)
        .fill(c.pop)
        .border(panel::BORDER, c.line)
        .absolute(rect[0], rect[1])
        .w(rect[2])
        .h(rect[3])
        .transition(opening())
}

fn row_view(s: &State, p: &Panel, depth: usize, i: usize, r: &Row) -> El {
    let c = s.look.palette;
    let on = i == p.active && r.takes_focus();
    // Only the pointer moving takes a row: hover alone also changes under a still pointer when
    // a panel opens or scrolls beneath it.
    let hover = move |s: &mut State, _: rune::PointerEvent, tx: &mut rune::Tx| look::hovered(s, depth, i, tx);
    let key = r.id().map(|id| look::row_key(&p.id, id));
    let el = match r {
        Row::Item(item) => item_view(&c, item, depth, i)
            .fill(if on { c.hover } else { c.pop.alpha(0.0) })
            .on_pointer_move_local(hover)
            .on_press_tx(move |s: &mut State, tx| look::pressed(s, depth, i, None, tx)),
        Row::Sep => row().w_full().h(panel::SEP).center_y().child(el().w_full().h(1.0).fill(c.line)),
        Row::Head { name, note } => row().w_full().h(panel::HEAD).items_end().pb(6.0).px(10.0).gap(8.0)
            .child(text(name.clone()).font(fonts::small(500.0)).color(c.ink2))
            .child(el().grow(1.0))
            .child(text(note.clone()).font(fonts::small(400.0)).color(c.ink2)),
        Row::Seg { label, choices, on: chosen, .. } => {
            let mut segs = row().grow(1.0).h(26.0).padding(2.0).gap(2.0).radius(6.0).fill(c.hover);
            if on {
                segs = segs.border(2.0, c.accent);
            }
            for (n, choice) in choices.iter().enumerate() {
                let picked = n == *chosen;
                let key = format!("{}-{n}", key.clone().unwrap_or_default());
                segs = segs.child(
                    row().key(key).grow(1.0).h_full().justify_center().center_y().radius(4.0)
                        .fill(if picked { c.pop } else { c.pop.alpha(0.0) })
                        .border(1.0, if picked { c.line } else { c.line.alpha(0.0) })
                        .child(text(choice.clone()).font(fonts::caption(if picked { 500.0 } else { 400.0 })).color(if picked { c.ink } else { c.ink2 }))
                        .on_press_tx(move |s: &mut State, tx| look::pressed(s, depth, i, Some(n), tx)),
                );
            }
            row().w_full().h(panel::SEG).pl(10.0).pr(6.0).gap(8.0).center_y().radius(5.0)
                .fill(if on { c.hover } else { c.pop.alpha(0.0) })
                .child(text(label.clone()).key(format!("seg-label-{i}")).font(fonts::caption(400.0)).color(c.ink2).w(56.0))
                .child(segs)
                .on_pointer_move_local(hover)
        }
        Row::Field { label, placeholder, value, .. } if depth + 1 < s.panels.len() || !on => {
            // Not the one typed in (under a second panel, or another row has the focus): its
            // text, not a field.
            let shown = if value.is_empty() { (placeholder.clone(), c.ink3) } else { (value.clone(), c.ink) };
            let boxed = row().grow(1.0).h(30.0).px(9.0).center_y().radius(6.0).fill(c.pane).border(1.0, c.line)
                .child(text(shown.0).font(fonts::ui(400.0)).color(shown.1).truncate().shrink());
            let mut line = row().w_full().h(panel::FIELD).py(3.0).px(2.0).gap(8.0).center_y();
            if depth + 1 == s.panels.len() {
                line = line.on_pointer_move_local(hover).on_press_tx(move |s: &mut State, tx| look::pressed(s, depth, i, None, tx));
            }
            if let Some(l) = label {
                line = line.pl(10.0).child(text(l.clone()).font(fonts::caption(400.0)).color(c.ink2).w(56.0));
            }
            line.child(boxed)
        }
        Row::Field { label, placeholder, .. } => {
            let input = text_input(&s.field, fonts::ui(400.0))
                .key("panel-field")
                .label(placeholder.clone())
                .w_full()
                .color(c.ink)
                .caret(c.accent, c.accent.alpha(0.25))
                .placeholder(placeholder.clone(), c.ink3)
                .on_edit(|s: &mut State| &mut s.field)
                .on_input_change(|s: &mut State, tx| insert::typed(s, tx))
                .on_input_key(editor::field_key);
            let mut boxed = row().grow(1.0).h(30.0).px(9.0).center_y().radius(6.0).fill(c.pane).border(1.0, c.line).child(input);
            if on {
                boxed = boxed.border(2.0, c.accent);
            }
            let mut line = row().w_full().h(panel::FIELD).py(3.0).px(2.0).gap(8.0).center_y().on_pointer_move_local(hover)
                .on_press_tx(move |s: &mut State, tx| look::pressed(s, depth, i, None, tx));
            if let Some(l) = label {
                line = line.pl(10.0).child(text(l.clone()).font(fonts::caption(400.0)).color(c.ink2).w(56.0));
            }
            line.child(boxed)
        }
        Row::Title(t) => row().w_full().h(panel::TITLE).items_end().px(10.0).pb(2.0)
            .child(text(t.clone()).font(fonts::ui(600.0)).color(c.ink).truncate().shrink()),
        Row::Text(t) => col().w_full().h(panel::TEXT).pt(4.0).px(10.0).pb(8.0)
            .child(text(t.clone()).font(fonts::caption(400.0)).color(c.ink2).wrap()),
    };
    match key {
        Some(k) => el.key(k),
        None => el,
    }
}

/// An item's row: its label, then any note, chip, check, key and "more" mark.
fn item_view(c: &Palette, item: &Item, depth: usize, i: usize) -> El {
    let mut r = row().w_full().h(panel::ITEM).pl(10.0).pr(8.0).gap(8.0).center_y().radius(5.0)
        .child(text(item.label.clone()).font(fonts::ui(400.0)).color(if item.off { c.ink3 } else if item.danger { c.fail } else { c.ink }));
    r = r.child(el().grow(1.0));
    if let Some(n) = &item.note {
        r = r.child(text(n.clone()).font(fonts::caption(400.0)).color(c.ink2).truncate().shrink());
    }
    if let Some(chip) = &item.chip {
        r = r.child(
            row().key(format!("chip-{depth}-{i}")).px(8.0).py(3.0).radius(10.0).border(1.0, c.line)
                .child(text(chip.clone()).font(fonts::small(400.0)).color(c.ink2))
                .on_press_tx(move |s: &mut State, tx| look::chip_pressed(s, depth, i, tx)),
        );
    }
    if item.check {
        r = r.child(text("✓").font(fonts::caption(400.0)).color(c.accent));
    }
    if let Some(k) = &item.key {
        r = r.child(row().px(5.0).py(3.0).radius(4.0).border(1.0, c.line).child(text(k.label()).font(fonts::key()).color(c.ink2)));
    }
    if item.more {
        r = r.child(text("›").font(fonts::ui(400.0)).color(c.ink2));
    }
    r
}

/// The row over both panes: the post's title, and "Saved" when the text is as written.
fn title_row(s: &State) -> El {
    let p = s.look.palette;
    let mut words = row().gap(10.0).items_end()
        .child(text(s.title.clone()).key("title").font(fonts::ui(500.0)).color(p.ink).truncate().shrink());
    if state::clean(s) {
        words = words.child(text("Saved").key("saved").font(fonts::caption(400.0)).color(p.ink2));
    }
    row().key("title-row").w_full().h(TITLE).px(12.0).center().fill(p.bg)
        .border_sides([0.0, 0.0, 1.0, 0.0], p.line)
        .child(words)
}

/// The line under the writing: a label in the state's color, one fact, and at most one action
/// with its key, for the caret's `new:` line or what just happened. Not drawn when there is
/// nothing to say.
fn status(s: &State) -> Option<El> {
    let p = s.look.palette;
    let said = draft::line(s)?;
    let color = match said.tone {
        draft::Tone::Dim => p.ink2,
        draft::Tone::Ink => p.ink,
        draft::Tone::Accent => p.accent,
        draft::Tone::Warn => p.fail,
    };
    let mut line = row().key("status").w_full().h(STATUS).gap(10.0).center_y().pl(22.0).pr(12.0)
        .fill(p.pane).border_sides([1.0, 0.0, 0.0, 0.0], p.line)
        .child(text(said.label).key("status-label").font(fonts::caption(600.0)).color(color))
        .child(text(said.fact).key("status-words").font(fonts::caption(400.0)).color(p.ink2).shrink().truncate())
        .child(el().grow(1.0));
    if let Some((name, key)) = said.action {
        line = line.child(
            row().key("status-action").gap(6.0).center_y().px(6.0).py(2.0).radius(5.0).cursor(Cursor::Pointer)
                .child(text(name).font(fonts::caption(500.0)).color(p.ink))
                .child(row().px(5.0).py(2.0).radius(4.0).border(1.0, p.line).child(text(key.label()).font(fonts::key()).color(p.ink2)))
                .on_press(|s: &mut State| draft::status_pressed(s)),
        );
    }
    Some(line)
}

fn writing(s: &State) -> El {
    let p = s.look.palette;
    let field = text_input(&s.edit, fonts::writing())
        .key("editor")
        .label("Writing")
        .w_full()
        .color(p.ink)
        .caret(p.accent, p.accent.alpha(0.25))
        .spans(s.spans.clone())
        .on_edit(|s: &mut State| &mut s.edit)
        // Return types a newline; without this it goes to the default button. A submit is not
        // reported as a change, so it records its own.
        .on_submit(|s: &mut State, _| {
            s.edit.insert("\n");
            state::changed(s);
        })
        .on_input_change(|s: &mut State, _| state::changed(s))
        .on_input_key(editor::key);
    let scroll = col().key("writing").w_full().grow(1.0).min_h(0.0).fill(p.pane).scroll(ScrollSpec { stick_bottom: false }).child(
        col().w_full().items_center().pt(TOP).pb(48.0).child(col().w_full().max_w(COLUMN).px(PAD).child(field)),
    );
    let mut pane = col().key("writing-pane").h_full().fill(p.pane)
        .on_layout(|s: &mut State, rect| s.pane = rect)
        .child(scroll);
    if let Some(line) = status(s) {
        pane = pane.child(line);
    }
    pane
}
