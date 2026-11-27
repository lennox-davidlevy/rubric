# The app: the shell (design round, then the plan)

Written 2026-11-26 as the handover to the session that plans the shell. It is not a build plan yet: it says where things stand, what the designer was asked for, and what the next session does with the round. The build plan is written into this file once the round is reviewed.

## Where things stand (2026-11-26)

- `main` has slices 1 to 3 and the move to the newer Rune (PRs #9, #12, #13). Slice 4 ([app-slice-4.md](app-slice-4.md)) is committed on branch `slice-4` (`2f224af`) and not merged.
- David ran all of section E of `testing/TESTING.md`. Everything passed but E15: the failed bar was drawn one line above its `::: new:` line (`reference/screenshots/failed-bar-misplaced.png`). **Not reproduced.** `a_draft_edge_stays_on_its_line_through_edits_around_it` in `app/tests/headless.rs` (uncommitted) tries Return and typing under the line, a long word on the line split off with Return, edits on the line above, and the same in a long post that scrolls: all pass. One lead, unconfirmed: `state::sync_draft_boxes` asks for a line's box when a key is handled, before the text is laid out again, and asks again only when the writing's size changes. David will say how he got there when it happens again (`RUBRIC_APP_TRACE=app/target/trace.log` records the keys). Do not change the code before it is reproduced.
- Rune is the fork `lennox-davidlevy/rune` at `ac6b482`: `41cfc07` with one line put back, which gives typing its speed again (0.15 to 0.28 ms a letter against 4 to 5 ms). The issue is filed with Rune; the pin goes back to `anomalyco/rune` once it is fixed there. The findings' "The move to Rune `41cfc07`" has all of it.
- The keyboard: `XMODIFIERS=@im=none` stays in `main.rs`. David runs with `RUBRIC_IME=1` for a week (from 2026-11-26); if no key is lost it comes out.
- The order of the app's work is in [plan.md](plan.md), step 9, "The order from here": the whole app on Linux, then the Mac. The shell is next, then zoom.

## How the work is done

David decides and tests by hand in his own window. A planning session writes a plan that stands alone in `docs/`; a builder builds it in sittings and never commits; the planning session reviews the diff and David's notes.

- **Planner and reviewer:** the Fable session for work that needs judgment (a slice's plan, a design round, a move of Rune). For simpler work an Opus session plans and reviews.
- **Builder:** Neon (Gemini, in Google's Antigravity), or an Opus session. The prompt for a builder says to read `CLAUDE.md` first, then the plan, and to report what it built, what it could not check, any row or test that did not pass, and a one-sentence commit message.
- **Review:** read the diff against the plan, run `cargo test` and `cargo test -- --ignored` in `app/` and the typing measure (`cargo run --release --features bench --bin typing -- --server`), check nothing is left running, and check the builder's summary against the record (one said "everything passed" when two rows had not).
- **Rows for David:** a section of `testing/TESTING.md`, one action a row, what to do on the left and what to expect on the right. He writes notes at the bottom of that file.
- No session opens a window on David's display, calls Jev, or runs a real draft.

## The design round

The design is the artifact https://claude.ai/artifact/SZkBTRdK4mhb9RVEi96JUJ (David's link to it is a chat with the designer; it is the same artifact). The local copy is `reference/rubric-design/` (ignored by git), pulled 2026-11-25 and equal to the live one when this was written: `RubricWindow.dc.html` and `Rubric Overview.dc.html`. `shots/` lacks pictures 01 to 05.

Before this round the design had one frame each of: a title row (window buttons, a drawer toggle, the title with `Saved`, `Publish`), a drawer (the site's name with `Sites`, `New post`, Posts with title, date and draft, Pages, then `Theme`, `Parts`, `Publish`), Sites (a `New site` tile and a tile a site) and the page dragged to a phone's width.

David gave the designer the brief below on 2026-11-26 and has a round back. **The next session's first job:** pull the artifact again (the Artifact tool's `read` with `paths` `project/RubricWindow.dc.html`, `project/Rubric Overview.dc.html`, `project/support.js`), compare it with the local copy, draw the new screens (serve the folder, headless Playwright on the Overview's cards at scale 2) and review them against the brief: what is there, what is missing, what breaks a rule, what Rune cannot draw. Then say what to send back to the designer, or, if the round holds, write the build plan here.

### The brief, as sent

Add the screens below to RubricWindow as new `screen` values, list them in the Overview under a new group "Shell", and extend the Menus table with any new keys (Mac and Linux). Keep every token, font, spacing and motion rule. Reuse the panel rows for any menu. Design states, not single frames.

1. **The toolbar.** What lives in it and in what order: the drawer toggle, the post's title and saved state, the view (both panes, writing only, page only), zoom, page width, open the page in the browser, Publish. Quiet enough to ignore; anything better as a menu or a key goes there. Two windows: the Mac with its window buttons, and Linux, where the system draws no title bar and the app's row is the top of the window. States: default, hovered, on, too narrow for everything.
2. **The drawer.** Posts: the current one marked, hover, draft against published, unsaved changes, a long list, no posts yet. Making a post (where its name is typed, what it is called before it has a title). A post's own menu: rename, duplicate, delete (asks once, Keep first). Pages beside posts. The keyboard: the key that opens it, arrows, Return, Esc. Where Theme, Parts, Publish and Sites sit. Shown over both panes and over writing only.
3. **Sites.** The tiles, hover, the current site. New site (what is asked and what is not). Opening a folder that is a Rubric site already. A site whose folder is gone. No sites at all, with one action. A site's own menu: rename, remove from the list (never deletes files).
4. **Zoom and page width, as one idea.** One control for the writing's size and the page's scale. The page zoomed out shows the whole page on a ground of another color. Widths: phone and desktop (a tablet only if it earns its place); decide whether width is the divider's job or a control's, and replace the old phone frame. Keys for in, out and reset, a pane.
5. **Saving.** The app saves by itself: what the title row says while writing, once saved, and when a save fails (title, one sentence, one fix).
6. **In line with what was built** (text only): `Own` reads `Custom`; `Back to quote` is `Cancel` while a draft runs, is ready or failed, and `Revert to original` on a kept variant; Insert part… with an empty field lists the groups with counts and a group opens its parts in a second panel, the field reading `Search parts`; `No picking key` reads `No Jev key`; menus open with Tab or a right-click on the line, and a right-click on writing shows Cut, Copy, Paste only; the two page states under the writing, `Page restarted` and `Page stopped` with `Reload`.

Rules: text states the action or the fact, never addresses the writer; a warning is a title, one sentence and one fix that starts with a verb; no number the writer does not act on; very few animations, nothing loops, no glow, only the four movements in the motion table unless a fifth is argued for; not a code editor; every screen in Paper, and the toolbar, drawer and Sites in Ink too. Not in the round: Parts, the theme picker and builder, Appearance, and what Publish does once pressed. At the end, the decisions David might overrule and what could not be settled.

## What the shell's plan has to settle, beyond the design

- What the app knows of a site today: it opens one file named on the command line and starts that site's process (`rubric lsp`). Switching posts, listing them, making, renaming and deleting one, and autosave are all new, and some need the server to answer (a list of the site's posts and pages, with title, date and draft).
- Sites: where the list of sites is kept (`$XDG_CONFIG_HOME/rubric/`), and `rubric new` for a new one.
- What Rune has for a drawer sliding over a pane and for a toolbar's controls, and what it lacks; find out before the plan promises it.
- The size of it: likely several sittings (the toolbar and the drawer with switching posts first; making and changing posts; Sites; autosave).
