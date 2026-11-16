//! Rubric's app, the first slice: the writing beside the page, on Rune.

pub mod editor;
pub mod ghost;
pub mod lsp;
pub mod markdown;
pub mod page;
pub mod position;
pub mod split;
pub mod state;

use rune::tok;
use rune::{Cursor, Cx, El, Phase, ScrollSpec, TextStyle, col, el, row, text, text_input};

use state::State;

/// The writing column's widest, in points.
pub const COLUMN: f32 = 720.0;
const LINE: f32 = 28.0;

/// The divider's width, in points.
pub const DIVIDER: f32 = 6.0;

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
        .on_layout(|s: &mut State, rect| s.width = rect[2])
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
    window
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
    col().key("writing").h_full().fill(t.bg).scroll(ScrollSpec { stick_bottom: false }).child(
        col().w_full().items_center().py(48.0).child(col().w_full().max_w(COLUMN).px(24.0).child(field)),
    )
}
