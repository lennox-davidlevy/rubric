# The app: the shell (the design round, and the plan for part 1)

Written 2026-11-26 as the handover to the session that plans the shell; that session reviewed the round the same day and wrote the plan below for the part that does not wait on the designer. Part 2 (making and changing posts, Sites) is planned once the designer's next round is back.

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

## The round, reviewed 2026-11-26

The round was pulled (the local copy now equals it; all 97 cards are in `reference/rubric-design/shots/`, the Shell group is 51 to 86) and holds for the toolbar, the drawer's list, the View popover and saving. It went back to the designer for:

- **What opens over the page.** The page is a native web view above everything the app draws. The View popover in page-only view, the post menu and its Delete step (drawn right of the drawer), tips for the controls at the right, and the status line in page-only view all land on it.
- **States named, not drawn:** Rename in place (a post, a site), tips for every control, the drawer's keyboard highlight, Sites on Linux and the way back from it, Open folder… on a folder that is no site, where Open in browser goes when the bar is narrow, Delete… on a draft.
- **A post's front matter.** The design starts a post at its `#` line; real posts hold `title`, `date`, `draft`, `tags` and `cover` in front matter. Where they are seen and set, and what New post asks, is not designed.
- **Settings.** There is no place for the app's settings (the Jev key after the first run, the folder new sites go in) nor a site's (name, address, where it publishes); the drafter sits in Appearance. A Settings window and a site's settings were asked for. Where a site publishes is later (David, 2026-11-26): writers deploy wherever they want, so no one host is built in; the designer draws it as one row that opens its own step, left empty.

Decided with David, 2026-11-26: the title is the front matter's `title`; the View button ships with the panes only, and the steppers and widths come with the zoom slice; Linux keeps one close button.

**The second round, reviewed the same day** (the local copy equals it; 123 cards, the Shell group is 51 to 112). It answers every point: tips stay in the toolbar; in page-only view the page gives up a 300-point column at the left for View and the drawer, 320 at the right for Publish and a strip at the foot for the status line; a post's menu and its Delete step open inside the drawer; the keys' row has a ring and the open post an edge and weight; the writing shows the title as its first line with one quiet line under it (date, Draft, tags, cover) that opens a Post panel (Ctrl+Shift+I), and New post asks nothing; Sites has a way back and its own row on Linux; Settings is a window of its own (Ctrl+,) and a site has its settings from the drawer's foot. Four slips went back and a third pull the same day has them fixed (Site settings stands alone; Model is a list that follows the drafting tool and fits any name; a menu low in the drawer opens upward; No sites has no way back). The design holds for the whole shell. For part 2: the writing no longer shows front matter, so the app holds the body apart from it and every line sent to the server is shifted by it.

## Part 1: the plan

Three sittings: the window and the toolbar; saving, and the server's list of a site's pages; the drawer, and switching between them. Not in part 1: New post, a post's menu (Rename, Duplicate, Delete), Sites, the drawer's foot (Theme, Parts, Publish), the Publish button, zoom and widths, tips at the right of the toolbar.

### Who builds it

Neon builds from this file, one sitting at a time, on a new branch `shell` off `slice-4`. The session that wrote it reviews each sitting's diff before the next starts. The builder reads `CLAUDE.md`, this file, `docs/app-slice-4.md` ("Decisions the build made") and in `docs/app-slice-findings.md` "Slice 4" and "The move to Rune `41cfc07`", and nothing from an earlier conversation.

A sitting stops at its end and says what it built, what it could not check, any test that did not pass, and a one-sentence commit message. Where this plan says "find out", the answer goes in the findings before the code that depends on it. Where the plan and the code disagree, the code is right: say so and go on. Where a decision is missing, take the smaller choice and write it under "Decisions the build made" at the end of this file; stop only for something that would change what the writer sees in a way neither this plan nor the design shows.

### What is known, checked 2026-11-26

Read in the source, not run, unless it says so.

- **The design.** `reference/rubric-design/RubricWindow.dc.html`; the pictures are `reference/rubric-design/shots/`: the toolbar 51 to 64, the drawer 65 to 69 and 77, the View popover 89 and 93, saving 97 to 99 and 102. The values below are the design's.
- **The window now** (`app/src/main.rs`): `AppSpec::new("Rubric", SIZE, init, view)` with no window options, so the system's frame. `lib.rs` `title_row` draws the title and `Saved` in a 40-point row (`TITLE`).
- **Rune, at `ac6b482`** (`~/.cargo/git/checkouts/rune-*/ac6b482/`):
  - a window with no frame: `WindowOptions.borderless` (`crates/rune/src/window/spec.rs`), set with `App::window_options`; a row that moves the window: `El::window_drag()` and `El::no_window_drag()` (`crates/rune/src/el/layout.rs`); edges that resize it: `El::window_resize(ResizeEdge)`; `Tx::close_window()`. Rune's own `Titlebar` keeps the native frame on X11, so it is not the way here.
  - layers: the app's panels are its own (`panel.rs`, drawn in `rune_kit::root(window, layer)`); the kit has `popover::anchored(k, content, anchor_key, Placement, gap)`, `scrim`, and tips through `El::help(text)` with `HelpLook::delay`.
  - movement: `El::offset_motion(Anim::new(Curve::tween(seconds, Easing)))`, `opacity_motion`, and `Transition` presets (`crates/rune-motion/src/transition.rs`).
  - lists: `El::scroll(ScrollSpec)`, `rune_kit::scroll_bar`, `El::virtual_rows`; `El::on_hover_change`; `El::on_secondary_press`.
  - `Tx::open_url(&str)` opens `http:` and `https:` with `xdg-open`.
- **The page** is a child X11 window over the app's drawing (`app/src/page.rs`). It takes its place from the `"page"` element's layout (`state::page_laid_out`), in pixels; a width or height of 0 hides it.
- **The page follows the document.** `rubric/cursor` makes the server tell the page the document's address (`workspace.cursor` gives `{source, url, line}`; `rubric-live.js` goes to `url` when it is not the page's). Opening another document and sending its cursor moves the page; nothing else is needed.
- **The server** keeps one text for each open document (`documents.onDidOpen`, `onDidClose` in `src/server/main.ts`) and watches `pages/` for files saved by others; a page an editor holds open is the editor's. `pageKind` (`src/site.ts`) says home, post or page from a path inside `pages/`. A site's pages are every `.md` under `pages/` (`src/build.ts` lists them so).
- **Saving now**: Ctrl+S (`editor.rs`) calls `state::save`, which writes the file whole and prints a failure. `state::clean` compares the text with what was last written.
- **Keys the app binds**: Ctrl+T and Ctrl+, (themes), Ctrl+S, Ctrl+Shift+R (Reload on a stopped page), and inside menus Ctrl+. Ctrl+R Ctrl+Enter. Ctrl+O, Ctrl+1, Ctrl+2, Ctrl+3 and Ctrl+Shift+B are free.
- **Not known:** whether the web view still attaches and sits right in a window with no frame; whether Rune draws an SVG path or the icons must be built from boxes and lines; whether Hugo's server draws a post with `draft: true` (it is run without `--buildDrafts` as far as a search shows).

### Decisions, made here (David may overrule any)

| Decision | Choice | Why |
|---|---|---|
| The window on Linux | No system frame; the app's row is its top, moves the window when dragged, and ends in one close button. The window's edges resize it | The design. On Hyprland nothing else changes |
| The window's corners | Square | The design's 10-point corners need a see-through window; not worth its risk now |
| The toolbar's order | Drawer, View, the title and the saved state in the middle, Open in browser, close | The design, less Publish |
| Publish | Not drawn until it does something (step 5) | A button that does nothing |
| The View popover | Both panes, Writing only, Page only, with a tick on the one shown and their keys. No steppers, no widths | Decided: they come with zoom |
| What is open at the left when the writing is narrower than it | The page gives way: while the drawer or the View popover is open its left edge is at 300 points or more, and it goes back when they close. In page-only view a failed save's status line takes a strip 34 points high at the window's foot the same way | The second round (pictures 93 and 102), and the same rule for a narrow window |
| Tips | Inside the toolbar, beside their control, never under it: name and key in a box 26 points high. Right of the control for the drawer and View, left of it for Open in browser and close | The second round |
| The title | The front matter's `title`; without one the first heading; without one the file's name | Decided |
| The saved state | `Edited` in `ink3` while the text is not written, `Saved` in `ink2` once it is, `Not saved` in the failed color at weight 600 when a write failed | The design |
| When it saves | One second after the last change, and at once before another post opens and when the window closes. Ctrl+S saves now | The design says about a second |
| A failed save | The status line under the writing: `Post not saved`, one sentence, `Retry` with Ctrl+S. It stays until a save works. The app tries again by itself at the next change | The design. A draft's line in the status gives way to it |
| Opening another post while a save fails | It does not open; the status line already says why | Nothing is ever dropped unsaved |
| What the app is started with | A file, as now, or a site's folder: then its newest post opens, or its home page when it has no posts | Sites comes in part 2 |
| The drawer's rows | The site's name as a heading (no `Sites`, no key), `Pages`, then `Posts`. No New post, no foot, no `···` | Part 2 and later |
| Pages | Home first (the site's `_index.md`, named `Home`), then the others by title. `rubric.md` is not listed | The design |
| Posts | Newest first by `date`; those with none last, by title | |
| A row's second line | The date as `12 June`, with the year when it is not this one; `Draft` after it when `draft: true`. Nothing else | `Unpublished changes` waits for Publish; `Not saved` on a post that is not open cannot happen |
| The row that is open | An accent edge 2 points wide at its left and its title at weight 600, with no fill | The second round |
| The row the keys are on | A ring in the accent, 1.5 points, radius 6; a row under the pointer has the hover fill | The second round |
| The drawer's keys | Ctrl+O opens and closes it; Up and Down move, Return opens the row and closes the drawer, Esc closes it. Typing does nothing while it is open | The design |
| Where the caret is in a post opened again | At its start | Remembering it is later |

### Sitting 1: the window and the toolbar

**Files.** `app/src/main.rs`, `app/src/lib.rs`, `app/src/state.rs`, `app/src/editor.rs`, a new `app/src/toolbar.rs`.

1. **Find out first**, in the nested window (`app/scripts/run-nested.sh`, the stub): with `borderless` the page attaches, sits in its pane and follows the divider and a resize. If it does not, stop the borderless work, keep the system's frame, build the rest of the sitting and say so.
2. **The window.** On Linux, `borderless`; the row is `window_drag`, its buttons `no_window_drag`; a strip 4 points wide at each edge and corner resizes (`window_resize`), under the row's controls, not over them. On the Mac nothing changes in this sitting.
3. **The row** (40 points, `bg`, a hairline under it, 12 points of padding at the sides): at the left, 4 points apart, the drawer button (28 by 26, radius 6) and View (26 high, 6 of padding, its icon and a small chevron in `ink2`); the title and the saved state in the middle of the window, 10 points apart, the title at 13 points weight 500 and never wider than 520 points (it ends in an ellipsis); at the right Open in browser (28 by 26) and, 14 points on, the close button (a 24-point circle filled with `hover`, a 10-point cross). A button under the pointer, or whose popover or drawer is open, is filled with `hover`. The icons are the design's (16-point boxes, 1.2-point lines); find out whether Rune draws a path, else build them from boxes and lines.
4. **Too narrow.** When the title at its full width would touch the buttons, it shortens first (to 300 points at the least); under that Open in browser leaves the row and is the last item of the View popover, under a hairline (picture 58).
5. **View.** Pressing it opens a panel under it (the app's own panel rows: three items with their keys, the one shown ticked), hung from the button, not the caret's line; Esc, a choice or a press elsewhere closes it. Ctrl+1 is both panes at half and half, whatever the split was (David, 2026-11-27, after running it), Ctrl+2 writing only, Ctrl+3 page only; they work with the popover closed. The divider still drags and snaps. The button is filled while one pane is hidden.
6. **The page gives way** (Decisions): one value in the state, the right edge of what is open at the left, read where the page's element takes its width. This sitting uses it for the View popover; sitting 3 for the drawer.
7. **Open in browser.** Ctrl+Shift+B or the button: `Tx::open_url` with the page's address for this post, which is the server's address (`rubric/serving`) and the path the page is on. Find out where the app can read that path (the server's cursor answer goes to the page, not the app); if it cannot, the server says it in a small notification of its own. With no server address yet the button is dimmed.
8. **Tips** (Decisions): `Posts and pages` with Ctrl+O, `View`, `Open in browser` with Ctrl+Shift+B, `Close window` with Ctrl+W, which also closes the window. Pictures 52, 54, 55 and 61.
9. **The title** from the front matter (`state::title_of`): `title:` plain or quoted, then the first heading, then the file's name.
10. `testing/TESTING.md` gains section F, rows for this sitting; `CLAUDE.md`'s State says where the app stands.

**Tests** (headless, each under 100 ms). The title is the front matter's, then the heading's, then the file's name. Ctrl+2 hides the page (its bounds go to 0) and Ctrl+1 brings back the split it had. The View panel opens from the button, ticks the pane shown, and a choice closes it and changes the split. With the split at page only and the popover open, the page's left edge is at 300 points; closed, it is back at 0. At a window 760 wide Open in browser is not in the row and is the View panel's last item, and the title's box does not cross a button's. Ctrl+W asks the window to close. Ctrl+Shift+B with an address asks to open it, and without one asks nothing. The close button asks the window to close.

### Sitting 2: saving, and the site's pages

**Files.** `app/src/state.rs`, `app/src/editor.rs`, `app/src/lib.rs`, `app/src/draft.rs` (the status line), `app/src/main.rs`; `src/server/main.ts`, `src/server/workspace.ts` or a new `src/server/pages.ts`, `test/`.

1. **Autosave.** A change sets a time one second on; when it passes with no later change the file is written (`state::save`). Find out what wakes the app then without work while nothing is due: the ticker thread in `main.rs` parks when it has nothing to count, and is the pattern. The app must still rest under 1% CPU with a clean post.
2. **The saved state** in the title row and **the failed save** in the status line (Decisions). The sentence says what the system said in a few words (`The site folder could not be written.` is the design's for a folder that refuses). Retry and Ctrl+S save again.
3. **Closing** the window saves first; if that fails the window still closes and the failure is printed.
4. **The server's list.** A request `rubric/pages` with no parameters answers `{ site: string, pages: [{ uri, kind: "home" | "page" | "post", title, date?: "YYYY-MM-DD", draft: boolean }] }`: every `.md` under `pages/`, `site` the home page's title or the folder's name, each title by the rule of sitting 1 from the editor's text when the document is open and from the file otherwise, in the order of Decisions. Front matter that does not parse gives the file's name and no date. It reads files on each call and keeps nothing.
5. **Started with a folder** (Decisions): the app starts the server on it, asks `rubric/pages`, and opens the first post, or the home page.

**Tests.** Bun: `rubric/pages` on a copy of `testing/` gives home first, pages by title, posts newest first with the undated last, `draft` true only where the file says so, and the title of an open document from the editor's unsaved text. App, headless with a temp file: a change is not written before a second and is after; a second change before the second moves the write on; the title row's state is edited, then saved; a path that cannot be written gives the failed state and the status action, and Retry on a path that now can clears both; a `new:` line's status gives way to the failed save. One ignored test with the real stub server: the app started on a copy of the site's folder opens its newest post.

### Sitting 3: the drawer

**Files.** A new `app/src/drawer.rs`, `app/src/lib.rs`, `app/src/state.rs`, `app/src/editor.rs`, `app/src/toolbar.rs`.

1. **The drawer** is 300 points wide, from under the title row to the window's bottom, over the writing, filled with `pop`, a hairline at its right; padding 14 at the top, 8 at the sides and bottom. The site's name at 14 points weight 600 (padding 6 by 10). A heading (`Pages`, `Posts`) at 12 points in `ink2`, padding 14, 10, 6. A row has padding 7 by 10 and radius 6: the title at 13 points on one line, ending in an ellipsis; under it, for a post, the date and `Draft` at 12 points in `ink2`, 1 point down. `No posts` in `ink3` when there are none. The list scrolls under the site's name with the kit's scroll bar when it is longer than the drawer; a long list is drawn with `virtual_rows` only if 500 posts measure slow without.
2. **It slides** in from the left in 140 ms and out the same way; the writing behind does not move. Nothing else in this sitting moves.
3. **Opening it** (the button, Ctrl+O) asks `rubric/pages` and draws what the app last had until the answer comes; the open row has the keys at first. Panels close when it opens. A press outside it closes it. While it is open the keys of Decisions are its own and the writing takes none. Closing gives the keys back to the writing.
4. **The page gives way** to the drawer by sitting 1's rule: in page-only view and in a window whose writing is narrower than 300 points.
5. **Opening a row.** The open post is saved first (Decisions for a failure). Then `textDocument/didClose` for it, the new file is read, and everything in the state that belongs to a document starts again as `State::open` makes it (the text and its undo, the version at 1, the pick, the menus, the drafts and their marks, every answer waited for), while what belongs to the window stays (the server, the page, the look, the split, the sizes). Then `didOpen` and `rubric/cursor`, which moves the page. An answer that comes late for the post before is dropped. A file that cannot be read leaves the open post open and says so in the status line: `Post not opened`, one sentence.
6. **From sitting 2's review.** `state::open_document` exists (starting on a folder uses it) and resets only the text and the saving state: finish it here. The drawer's titles, dates and order are the server's (`rubric/pages`), never the app's own reading of a file, so one rule decides a title. Before any write, autosave included, the file is compared with what the app last wrote or read; when another editor changed it, nothing is written and the status line says `Post changed on disk`, one sentence, with `Reload` (the file's text replaces the writing) — find out the cheapest sound comparison (size and modified time, then the text only when they differ).
7. Rows for David in section H; the findings gain "The shell, part 1" with each "find out", the typing measure (`cargo run --release --features bench --bin typing -- --server`, p95 under 4 ms) and the time from Return on a row to the new post's text drawn (the aim: under 50 ms, the server's answer not waited for).

**Tests** (headless, the recording client). Ctrl+O opens the drawer and sends `rubric/pages`; the answer's rows are drawn in its order with the open one marked. Down and Return on the next post send `didClose` for the first and `didOpen` for the second with its text, then `rubric/cursor` for it; the title row has its title; the version is 1; undo does not bring back the first post's text. An unsaved change in the first post is on disk before the second opens. With a first post that cannot be written, Return opens nothing and the first stays. An answer to a request made for the first post changes nothing after the switch. Esc closes the drawer and the next letter goes into the writing. With page only, the page's left edge is at 300 points or more while the drawer is open. One ignored test with the real stub server: two posts opened in turn, and the page's address asked of the relay is the second's.

### Rules for every sitting

- No call to Jev, no real drafts, nothing that costs money. Never pass `--live` or set `LIVE`. Never read `.env`.
- No window on David's display: the nested window only (`app/scripts/run-nested.sh`). Do not touch a site process the session did not start, nor `testing/` but `testing/TESTING.md`; tests copy the site to a temp folder.
- Change nothing outside `app/`, the server files a sitting names with their tests, this file, `docs/app-slice-findings.md`, `testing/TESTING.md` and `CLAUDE.md`. Do not change the Rune pin; `app/Cargo.toml` changes only if a sitting cannot be built without it, said in the report.
- Text the writer sees states the action or the fact, in American English. Tests assert what was sent, saved and opened, never a row's wording.
- `cargo test` in `app/` and `bun test` pass at the end of each sitting, each under 30 seconds; `cargo test -- --ignored` when a sitting adds one.
- Do not commit. Stop every process the session starts and check that it is gone.

### Decisions the build made

One line each: what was chosen, and why the plan did not settle it.

- In page-only view (`split == 0.0`) the 6-point divider stays at the left edge so it remains draggable back (matching existing `lib.rs` and `headless.rs`), so the page's resting left edge is `DIVIDER` (6 points); while the View popover (or drawer) is open, `page-cover` takes `[0, left_cover]` (`300` points) in `p.pane` with a 1-point `p.line` right border (matching picture 93).
- Without Publish on Linux the toolbar's buttons are narrower than the design's Mac bar, so the narrow breakpoint hides Open in browser from the row (moving it to the end of the View popover under a hairline) at or below 760 points, while reserving a fixed 74 points beside the title for the saved state word (`Saved`, `Edited`, `Not saved`) so `title_max` shrinks smoothly with no jump at 760 points and never wobbles across save-state transitions.
- The server notifies the editor with `rubric/page` (`{ uri, url }`) on open, cursor, and front-matter URL changes whenever a page's path changes for that connection; the app joins it with `rubric/serving` for Open in browser.
- Side resize strips (`West`, `East`) sit beneath `panes` so a divider snapped to either edge stays draggable, top strips sit inside `title-row` beneath its controls, and bottom strips span the bottom 4 points of the window.
- The `page` element and its cover spacer use `El::instant_changes()` so the native X11 web view updates its bounds in one step instead of thrashing through spring frames when the View popover opens or closes.
- Toolbar tips (`Posts and pages` with `Ctrl+O`, `View`, `Open in browser` with `Ctrl+Shift+B`, `Close window` with `Ctrl+W`) use Rune's `El::help_side(Side::Right | Side::Left)` so each 26-point tip sits inside the 40-point toolbar beside its control and never overlaps the native web view.
- The web view is never unmapped with `set_visible(false)` once attached (unmapping and remapping at the same size left WebKitGTK blank); in writing-only view `state::page_laid_out` keeps its last size and parks it fully outside the window (`+64` px past right and bottom), moving it back when the pane returns.
- The drawer button is dimmed (`ink3`) with no hover fill until sitting 3 implements the drawer.
- Keys delivered to the page's X11 window while the page does not hold keys are stopped in GTK (`key-press-event` / `key-release-event` on `webview.toplevel()` and `webview`) and forwarded to Rune via `Tx::send_key`; a press in the page (`button-press-event`) hands keys to WebKit until the next press anywhere in the app (`El::on_any_press` sends `PageCmd::Keys(false)`) or any window-wide app chord (`toolbar::window_chord`), which still goes to the app, stops at the page, and returns keys to the app.
- Window-wide shortcuts live in one table (`toolbar::SHORTCUTS` / `toolbar::Shortcut`) read by `toolbar::key`, `toolbar::window_chord`, `look::themes_key`, `draft::status_key`, tooltips, and the View popover, so adding a shortcut changes one place.
- Autosave uses Rune's `Tx::wake_after` and `AppSpec::poll` (`state::poll`, combining `insert::poll` and autosave) rather than a second background thread, keeping idle CPU at 0.00% and allowing virtual-clock headless tests.
- In page-only view (`split <= 0.0`), a failed save or stopped page draws the 34-point status bar full-width at the window's foot below `panes` so the native web view yields 34 points at the bottom (matching picture 102).
- `rubric/pages` (`src/server/pages.ts`) gives `_index.md` its own title by sitting 1's rule (also used as `site`, falling back to the folder's name when `_index.md` has no front-matter title or heading); sitting 3's drawer labels `kind: "home"` as `Home`.
- Starting the app on a site folder (`State::open_folder`) connects to the server asynchronously, requests `rubric/pages`, and opens the newest post (or home page when there are no posts) via `state::open_document` without blocking the first frame.

## Part 2, once the designer's round is back

New post and what it asks; a post's menu (Rename, Duplicate, Delete); the place for a post's title, date and draft; Sites, with where the list of sites is kept (`$XDG_CONFIG_HOME/rubric/`), `rubric new` for a new one, the folder picker (Rune's `native-file-dialog` feature, off in `app/Cargo.toml` today) and Show folder (Rune has no call for it); the drawer's foot. Settings and a site's settings follow the design once drawn, with step 5.
