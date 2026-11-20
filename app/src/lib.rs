//! Rubric's app, the first slice: the writing beside the page, on Rune.

pub mod draft;
pub mod editor;
pub mod ghost;
pub mod lsp;
pub mod markdown;
pub mod menu;
pub mod page;
pub mod position;
pub mod split;
pub mod state;

use rune::tok;
use rune::{Align, Cursor, Cx, El, Phase, ScrollSpec, Side, TextStyle, col, el, row, text, text_input};
use rune_kit::{Kit, Placement, PopupItem, PopupList, popover};

use state::State;

/// The writing column's widest, in points.
pub const COLUMN: f32 = 720.0;
const LINE: f32 = 28.0;

/// The divider's width, in points.
pub const DIVIDER: f32 = 6.0;

/// The height of the line under the writing that says where a `new:` line's draft is.
pub const STATUS: f32 = 28.0;

pub fn view(s: &State, cx: &mut Cx<State>) -> El {
    let t = tok::theme(false);
    let scale = cx.env().scale;
    let room = (s.width - DIVIDER).max(0.0);
    let left = (room * s.split).round();
    let divider = el().key("divider").w(DIVIDER).h_full().fill(t.separator).cursor(Cursor::ResizeColumn)
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
    let page = el().key("page").w(room - left).h_full().fill(t.bg)
        .on_layout(move |s: &mut State, rect| state::page_laid_out(s, rect, scale));
    let mut window = row().key("window").w_full().h_full().fill(t.bg)
        .on_layout(|s: &mut State, rect| {
            s.width = rect[2];
            s.height = rect[3];
        })
        .child(writing(s).w(left))
        .child(divider)
        .child(page);
    // The pick, dimmed, right after the caret; the caret is read only while there is one, so
    // the view does not re-run on every caret move.
    if let Some(g) = state::showing(s)
        && let Some([x, y, w, _]) = cx.caret("editor")
    {
        window = window.child(
            text(g.pick.show.clone()).key("ghost").font(TextStyle::new(markdown::BODY, 400.0).lh(LINE))
                .color(t.text_secondary).absolute(x + w, y),
        );
    }
    // The menu, in a layer above the window's, anchored to an element at the caret. It stays
    // inside the writing pane: the page is a native window over everything right of it.
    let mut layer = Vec::new();
    if let Some(menu) = &s.menu
        && let Some(caret) = cx.caret("editor").or(s.menu_at)
    {
        let notes = menu.kind == menu::Kind::Notes;
        let rows = if notes { 3 } else { menu.rows.len() + 1 };
        let at = menu::place(caret, [0.0, 0.0, left, s.height - STATUS], rows);
        window = window.child(
            el().key("menu-anchor").absolute(at.x, at.y).w(1.0).h(caret[3])
                .on_layout(|s: &mut State, rect| s.menu_at = Some(rect)),
        );
        let kit = Kit::neutral(false);
        if notes {
            let field = text_input(&s.notes, kit.ty.ui_compact)
                .key("notes")
                .label("Notes")
                .w_full()
                .color(kit.c.text_base)
                .caret(t.text, tok::accent(0, false).alpha(0.25))
                .placeholder("notes", kit.c.text_weak)
                .on_edit(|s: &mut State| &mut s.notes)
                .on_submit(|s: &mut State, tx| draft::reroll_with_notes(s, tx))
                .on_input_key(editor::notes_key);
            let body = col().key("menu-notes").w(at.width).padding(12.0).gap(8.0)
                .child(text(menu.title.clone()).font(kit.ty.ui_compact).color(kit.c.text_weak))
                .child(field);
            let placement = if at.side == Side::Top { Placement::TopStart } else { Placement::BottomStart };
            layer.push(popover::anchored(&kit, popover::raised(&kit, body, kit.radius.md), "menu-anchor", placement, menu::GAP));
        } else {
            // The title is a first row that cannot be chosen.
            let title = PopupItem::new("menu-title", menu.title.clone()).disabled(true);
            let items = menu.rows.iter().map(|r| PopupItem::new(r.id.clone(), r.label.clone()).description(r.note.clone().unwrap_or_default()));
            PopupList::new("menu", "menu-anchor")
                .anchored("menu-anchor", at.side, Align::Start, menu::GAP)
                .width(at.width)
                .max_height(8.0 * menu::ROW)
                .items(std::iter::once(title).chain(items))
                .active(Some(menu.active + 1))
                .on_active(|s: &mut State, i| draft::active(s, i.saturating_sub(1)))
                .on_choose(|s: &mut State, id, tx| draft::chose(s, id, tx))
                .build(&kit, &mut layer);
        }
    }
    rune_kit::root(window, layer)
}

/// The line under the writing: where the caret's `new:` line is, or what just happened.
fn status(s: &State) -> El {
    let t = tok::theme(false);
    let mut line = row().key("status").w_full().max_w(COLUMN).px(24.0).h(STATUS).gap(8.0).center_y();
    if let Some((mark, words, tone)) = draft::line(s) {
        let theme = state::theme();
        let color = match tone {
            draft::Tone::Dim => theme.dim,
            draft::Tone::Accent => theme.accent,
            draft::Tone::Warn => theme.warn,
        };
        let font = TextStyle::new(13.0, 400.0);
        line = line
            .child(text(mark.to_string()).font(font).color(color))
            .child(text(words).key("status-words").font(font).color(t.text_secondary).shrink().truncate());
    }
    col().w_full().items_center().fill(t.bg).child(line)
}

fn writing(s: &State) -> El {
    let t = tok::theme(false);
    let field = text_input(&s.edit, TextStyle::new(markdown::BODY, 400.0).lh(LINE))
        .key("editor")
        .label("Writing")
        .w_full()
        .color(t.text)
        .caret(t.text, tok::accent(0, false).alpha(0.25))
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
    let scroll = col().key("writing").w_full().grow(1.0).min_h(0.0).fill(t.bg).scroll(ScrollSpec { stick_bottom: false }).child(
        col().w_full().items_center().py(48.0).child(col().w_full().max_w(COLUMN).px(24.0).child(field)),
    );
    col().key("writing-pane").h_full().fill(t.bg).child(scroll).child(status(s))
}
