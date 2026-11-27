# The app: slice 4, the right-click and a draft's line

Written 2026-11-26. Slice 3 and the move to the newer Rune are on `main`. This slice is one sitting: the menu from a right-click in the writing, a draft's line marked at its edge with its state at its right, a panel that no longer jumps when Change… opens from a pick, and the part's menu asked for in one go. Problems (the underline and message for a mistake) are not in it; they are the slice after the Mac.

## Who builds it

Neon builds from this file in one sitting on a new branch, `slice-4`, off `main`. The session that wrote it, or an Opus session, reviews the diff. The builder reads `CLAUDE.md`, this file, `docs/app-slice-3.md` ("Decisions, made here" and "Decisions the build made"), and in `docs/app-slice-findings.md` "Slice 3: the designed menus" and "The move to Rune `41cfc07`", and nothing from an earlier conversation.

The sitting stops at its end, says what it built, what it could not check and the commit message. Where this plan says "find out", the answer goes in the findings before the code that depends on it. Where the plan and the code disagree, the code is right: say so and go on. Where a decision is missing, take the smaller choice and write it under "Decisions the build made" at the end of this file; stop only for something that would change what the writer sees in a way neither this plan nor the design shows.

## What is known, checked 2026-11-26

- **Rune** is the fork `lennox-davidlevy/rune` at `ac6b482`: `41cfc07` with one line put back (the findings have why). Its source is cargo's checkout, `~/.cargo/git/checkouts/rune-*/ac6b482/`.
- **A right-click's place in the text**: `El::on_secondary_press` gives the point (`PointerPress { x, y }`, window points), and `Tx::text_offset_at(key, x, y, f)` runs `f(state, Option<usize>, tx)` with the byte under it, after the handler and before the view is committed (`crates/rune/src/el/tx/pick.rs`). The headless `Runtime` has `secondary_down` and `secondary_up`.
- **Rune shows no menu of its own on Linux** for a right-click in a field (`popup_menu_supported()` is false there; on the Mac and Windows it shows the system's). A field with its own `on_secondary_press` gets the press instead on every system (`runtime/input/secondary.rs`). Read by the builder of the move, not checked again here.
- **A line's box**: `Tx::text_line(key, byte, f)` and `Runtime::text_line(key, byte)` give `TextLine { rect, start, prev, next }` for the visual line holding a byte: `rect`'s `y` and `h` are the line's, its `x` and `w` span the field's text. Not known: whether the view can read one while it builds (something on `Cx`).
- **A bar at a line's left**: `LineFill::new(start, end).left_bar(width, color)` on the field (`El::line_fill`, `El::line_fills`) draws over the visual lines of a byte range, changing nothing in the text or its undo. It is a solid bar; it has no dotted or dashed form.
- **The design's edge and label** (`reference/rubric-design/RubricWindow.dc.html`, the table `E` and the `label` of a line): 2 points wide, 18 points left of the writing; before a draft dotted in `ink3` with `Not started`; drafting, dashed in the accent with `Drafting 0:14`; ready, solid in the accent with `Ready`; failed, solid in the failed color with `Failed`. The label is at the line's right end, in the state's color.
- **The app now**: Tab is `state::tab` (`app/src/editor.rs`, `key`): with a pick showing it takes the pick, otherwise it opens the line's menu. The lines that have a draft and its state are already known to the view: `markdown::spans` takes `drafts: &[(u32, Tone)]` and colors those lines' `:::` by them (`state::spans`). The status line under the writing says the caret's line's state.
- **The panel that jumps** (found in the run of section D): on `::: quote cite=a : torn edge`, Tab on the pick `⇒ change quote` drew the panel at the pane's top left and slid it to the line. `part::answered` (`app/src/part.rs`, the `What::PartLook` arm) clears the panel's place, opens Change… and gives its field the keys in the same turn; with the keys in the field the editor reports no caret, so the place falls back to the top of the column for a frame.
- **The part's menu asks twice, one after the other**: `rubric/part`, and on its answer `rubric/draft` with no action. In the native run 4 of 15 Tabs took 34 to 51 ms where the rest took 1.5 to 4.3 ms, in steps of a frame.

## Decisions, made here (David may overrule any)

| Decision | Choice | Why |
|---|---|---|
| What a right-click opens | The menu Tab would open on the line pressed, never the pick: on a part's line its menu, on a `new:` line its draft menu, on a line of words the words menu, on an empty line Insert part…, New part…, Cut, Copy, Paste | One menu a line, however it is asked for. Tab takes a pick; a right-click must not write anything |
| A right-click on a line of writing | Cut, Copy, Paste, and nothing else | Insert part… writes on the caret's line, and that line has writing. The design lists Insert part… there too; where the part would go is not designed |
| The caret | Goes to the place pressed, unless the press is inside the selection, which then stays | As every editor does; Cut and Copy act on what was selected |
| Where the panel hangs | From the start of the line pressed, as every panel does; not at the pointer | One place for a line's menu |
| The page | A right-click in the page is not this slice's | It is the web view's, and owed later |
| The edge | A solid bar 2 points wide for every state: `ink3` before a draft, the accent at half strength while drafting, the accent when ready, the failed color when failed | Rune's bar is solid only. If the builder finds a dotted and a dashed line can be drawn for the same cost, the design's are used |
| The label | The state's word at the right end of the line, in the state's color, with the seconds while drafting, as the design draws it | The status line stays as it is: it speaks for the caret's line, the label for every line with a draft |
| Which lines | Every line the app already colors by a draft's state: `new:` lines, and a part's line while its take or variant drafts, is ready or failed | The state is already there |
| Workarounds Rune now answers | Left alone (`preserve_focus_on_press`, `anchored_in`, `on_input_selection`, `on_key_preview`) | They work; replacing them is not this slice |

## Tasks

In order. Each ends with `cargo test` passing in `app/`, under 30 seconds. Tests assert what was sent, what the text and the caret became and what is open, never a row's wording beyond its id.

### Task 1: the right-click menu

**Files.** `app/src/lib.rs`, `app/src/editor.rs`, `app/src/state.rs`, `app/src/insert.rs`.

- The writing field takes `on_secondary_press` and asks `text_offset_at` for the byte under it. With no byte (the press was not on the field's text) nothing happens.
- Open panels close first, as any press in the writing closes them.
- The caret goes to the byte, with nothing selected, unless the byte is inside the selection.
- Then the line's menu opens by the path Tab uses, but past the pick: a pick showing is neither taken nor shown in the menu's place. Split `state::tab` so the menu's part can be called alone; Tab itself does what it did.
- On a line of writing (not empty, not a `:::` line) the menu is Cut, Copy, Paste, Cut and Copy dimmed with nothing selected, as the empty line's menu has them.
- Find out, in a headless test first, that the panel hangs from the pressed line and not the line the caret was on before the press: the place is taken when the panel opens, and the caret has just moved.
- `CLAUDE.md`'s State says the menus open with Tab because Rune could not place a right-click: say what is true now.

**Tests.** Headless, with `secondary_down` and `secondary_up` at a line's place: a press on a part's line sends `rubric/part` for that line and moves the caret there; on a `new:` line it opens the draft menu; on an empty line the rows are the empty line's; on a line of writing the rows are Cut, Copy, Paste and nothing is sent; with a pick showing on the pressed line the text is unchanged and the menu opens; a press inside a selection keeps the selection and Copy is not dimmed; a press with a panel open on another line leaves one panel, the pressed line's.

### Task 2: the panel does not jump

**Files.** `app/src/part.rs`, `app/src/lib.rs` or `app/src/state.rs`.

The panel's place is taken from the line before the field takes the keys: either the place is kept across `part::answered` when the line is the same, or it is read with `text_line` when the menu is asked for. The builder chooses the smaller; the place's other rules (it follows scrolling and a resize, stays when a setting is written) hold.

**Test.** Headless: on a line whose pick has `change`, Tab; in the first frame the panel is drawn, and in every frame after, its left edge is the line's text's and its top is under the line. It fails on `main`.

### Task 3: the part's menu in one go

**Files.** `app/src/part.rs`, `app/src/state.rs`, `app/src/draft.rs`.

- Find out first that `rubric/draft` with no action writes nothing and costs nothing on a line that places no part (a line of words): read `src/server/workspace.ts` and `main.ts`. If it does either, stop this task and say so.
- Tab, or a right-click, on a `:::` line that names something sends `rubric/part` and `rubric/draft` together. The menu opens when both have answered; if `rubric/part` answers that there is no part, the words menu opens as now and the draft's answer is dropped. An answer for a line that changed is dropped, as now.
- `menu drawn N ms` keeps saying which menu and the server's share, now the time from sending to the later answer.
- Find out why an answer sometimes waits a frame or two (the reading thread waking the window; a frame already on its way) and write it in the findings. Fix it only if the fix is a line or two.

**Tests.** Headless with the recording client: one Tab on a part's line sends both requests before either is answered; the menu opens whichever answers first; no part and a draft answer opens the words menu once; the text changed between the two answers opens nothing. The stub server test for the part's menu still passes.

### Task 4: a draft's line, its edge and its state

**Files.** `app/src/lib.rs`, `app/src/state.rs`, `app/src/draft.rs`.

- **The edge.** For each line `state::spans` gets a draft state for, a `LineFill` over that line's bytes with a 2-point bar in the state's color (Decisions). Find out where Rune draws the bar against the field's padding: it must sit left of the writing with a gap, near the design's 18 points, and never under the first letter. If it lies on the text's edge, draw the bar as an element of the app's from the line's box instead, or say that neither can be done and leave the edge out.
- **The label.** The state's word at the right end of the same line: `Not started` in `ink3`, `Drafting` with the seconds in the accent, `Ready` in the accent, `Failed` in the failed color; captions at 12 points in the interface's font. It needs the line's box. Find out whether the view can read `text_line` while it builds; if only a handler can, the boxes are kept in the state and read again when the writing scrolls, the pane is resized or the text changes, as the panel's place is. A label never lies over the line's own words: when the line's text reaches it, the label is not drawn for that line. Lines scrolled out of the pane draw nothing.
- If the label cannot follow its line without work on every frame while nothing changes (the app must stay idle under 1% CPU), say so in the findings, build the edge alone and stop: the status line already says the state.
- The seconds are those the status line counts; one clock, no second timer.

**Tests.** Headless: a `new:` line not started has one bar in `ink3` over its line and no other line has one; the bar's color follows drafting, ready and failed; a part's line has one while its variant drafts and none once kept; the label's element is at the line's `y` and inside the writing pane, moves by the same amount when the writing scrolls, and is gone when the draft is kept or canceled. A check that the app asks for no frame while a ready line sits untouched.

### Task 5: measure, and write it down

- `cargo run --release --features bench --bin typing -- --server`: the numbers beside the move's in the findings. A typed character on a `new:` line must still meet its budget with the edge and label drawn (p95 4 ms; it was 0.18 ms).
- `docs/app-slice-findings.md` gains "Slice 4": each "find out" answered, the numbers, and what no one saw.
- `testing/TESTING.md` gains section E, one action a row, what to do on the left and what to expect on the right: a right-click on each kind of line; a right-click inside a selection, then Copy; a right-click with a pick showing; the pick `⇒ change quote` taken with Tab (the panel opens in place); ten Tabs on a part's line (the times printed); a `new:` line through not started, drafting, ready and failed with the stub (the edge and the label each time); the label while the writing scrolls; a long `new:` line that reaches the label.
- `CLAUDE.md`'s State: where the app stands.

## Rules for the session

- No call to Jev, no real drafts, no bench runs that cost money. Never pass `--live` or set `LIVE`. Never read `.env`.
- Never send `keep` with `global: true`, nor `remove`, to a server whose site or catalog is not a copy in a temp folder.
- No window on David's display. Don't touch `testing/` but `testing/TESTING.md`, nor a site process the session did not start.
- Change nothing outside `app/`, this file, `docs/app-slice-findings.md`, `testing/TESTING.md` and `CLAUDE.md`. The server does not change in this slice.
- Do not change the Rune pin or anything in `app/Cargo.toml`.
- Do not commit. Stop every process the session starts and check that it is gone.

## After this slice

The Mac: the app has never been built there, and the page beside the writing is attached on Linux only. Then problems, the first run, and the package (`docs/app-slice-3.md`, "After this slice").

## Decisions the build made

One line each: what was chosen, and why the plan did not settle it.
