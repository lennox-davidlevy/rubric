# The app: slice 3, the designed menus

Rewritten 2026-11-25. The first plan for this slice (2026-11-20) mirrored Neovim's menus entry for entry. Since then the menus were designed (below), and this slice builds those instead: the app's look, one panel that holds rows, controls and a field, the draft menus in it, and the menu on a placed part with its settings. Slices 1 and 2 are on `main` (PR #9); the branch is `slice-3`.

## The design

`reference/rubric-design/` (ignored by git) holds the design as pulled on 2026-11-25: `RubricWindow.dc.html` (every screen, as one component with a `screen` value), `Rubric Overview.dc.html` (the screens side by side, the Menus table with Mac and Linux keys, motion, tokens) and `shots/` (each screen drawn at 1180 by 740, numbered as the Overview lists them). The live copy is the artifact https://claude.ai/artifact/SZkBTRdK4mhb9RVEi96JUJ. Read the screen's entry in `partsInEditor` (`RubricWindow.dc.html`, the `D[...]` table) before building it: the rows, their order, their keys and what is highlighted are there exactly.

Where the design and this plan differ, the plan wins; each difference is in "Decisions".

## Who builds it, and in how many sittings

An Opus session builds from this plan; the session that wrote it reviews. The slice is three sittings, each a fresh session that reads this file, `docs/app-slice-findings.md` and the design's screens for its tasks, and nothing from an earlier conversation:

| Sitting | Tasks | Ends with |
|---|---|---|
| 1 | 1 and 2: the look, the panel | The app themed, the theme list opening with Ctrl+, |
| 2 | The review's fixes ("Before task 3"), then 3 and 4: the draft menus, the server's two requests | Every draft menu in the panel; `bun test` passing |
| 3 | 5, 6 and 7: a placed part, insert, the write-up | Section C of `testing/TESTING.md` ready for David |

A sitting stops at its end, says what it built, what it could not check and the commit message, and does not start the next. Where this plan says "find out", the answer goes in the findings before the code that depends on it. Where the plan and the code disagree (a line number, a field's name), the code is right: say so and go on. Where a decision is missing, take the smaller choice, write it under "Decisions the build made" at the end of this file, and go on; stop only for something that would change what the writer sees in a way the design does not show.

## How the session checks its work

With the tests: the headless `Runtime`, and the stub server on a temp site. The session opens no window on David's display unless he says it may; he runs `app/target/release/rubric-app sites/app-slice/pages/posts/long.md` himself. The findings say plainly what no one saw. Rune's source is cargo's checkout, `~/.cargo/git/checkouts/rune-c9b805e9ed8a3730/0ca0756/`.

## Decisions, made here (David may overrule any)

| Decision | Choice | Why |
|---|---|---|
| The look comes first | Task 1 is tokens, type and the bars | The menus are drawn in them; built unstyled they would be built twice |
| Two kinds of theme | The app's own colors ("Appearance") are this slice's. The site's theme (Paper, Schematic, the skins; `::: theme` in `rubric.md`) is Rubric's own and is not touched here | David, 2026-11-25: Pathlight's way for the app, what Rubric has built for the site |
| App themes | Pathlight's way (`pathlight/src/theme.ts`: `resolveRoles`, `derivePalette`, `loadThemes`), ported to Rust: OpenCode's theme format, Pathlight's 31 OpenCode themes copied with their notice (`pathlight/NOTICE.md`, MIT), the design's four (Paper, Ink, Sepia, Fjord) beside them, and the writer's own files from `$XDG_CONFIG_HOME/rubric/themes/` | David wants every one of them, easily changed |
| Changing it | Ctrl+, (Cmd+, on the Mac) opens the list in a panel: moving draws the app in that theme, Return keeps it (written to `$XDG_CONFIG_HOME/rubric/app.json`), Esc goes back to the one before. Paper until one is kept; `RUBRIC_APP_THEME=<name>` for one run | Pathlight's picker; the design's Appearance window, with Markdown and the drafter in it, is a later slice |
| Light or dark | Chosen in the list of themes and kept with the theme (see "Before task 3"); `RUBRIC_APP_MODE=dark` for one run; no following the system | Pathlight follows a terminal's background; following the desktop is new work, for the Appearance slice |
| Fonts | Instrument Sans, Literata and JetBrains Mono, vendored in `app/fonts/` with their licenses, compiled in | Rune takes font bytes at build time; nothing is fetched at run time |
| The title bar | A 40-point row the app draws under whatever frame the system gives: the post's title and "Saved" or nothing | Rune replaces the native bar on the Mac only; on Hyprland there is none to replace |
| One panel, not `PopupList` | The app's own panel (`panel.rs`) in Rune's `popover::raised`, from `el`, `row`, `col`, `Segmented` and `text_input` | `PopupList` rows have one shape: no separators, headers, controls or fields |
| Keeping a draft | "Keep" keeps for this site and asks nothing. A kept part's own menu has "Add to every site", which puts it in the catalog as Neovim's "Add name to every theme" does (`keep` with `global: true` on the part's line). Neovim is not changed in this slice | The menu is keep, reroll, cancel; the catalog is the writer's, and a part they want everywhere goes into it (David, 2026-11-25) |
| Groups | Each part in the catalog gets a `group` (a label Jev is not sent, so no version bump); Insert part… with an empty field lists by group. With words the list is flat, in Jev's order from one call | The design draws groups. A second call to pick the group first would hide the right part whenever the group is wrong, and cannot be judged without a live probe: see "After this slice" |
| Remove on a catalog part | Takes the part's line and its closer; the writing inside stays | David, 2026-11-25: words wrapped in a part and unwrapped again must not disappear |
| A setting's change | The server rewrites the line (`rubric/part` with `set`) and answers it as `replace` | One place knows a line's syntax |
| Words in the part's panel | Return puts ` : <words>` at the line's end with the caret after it; the pick shows as it does when typed | The second pass exists; no new request |
| Keys | Ctrl on Linux, Cmd on the Mac: Enter keeps or drafts, R rerolls, `.` stops, Delete removes; Tab or a right-click opens the menu | The design's Menus table |
| No Jev key | The status line says "No Jev key"; the editor works as ever | Writing needs no key. The design calls it a "picking key", which says nothing (David, 2026-11-25); connecting it belongs to the first run, below |

Not in this slice: problems (the underline and message for a mistake), an image setting's file row, the menu from a right-click in the page, the first-run screens, the drawer, Sites, Parts, the site's theme (its picker and builder), the Appearance window, Publish, autosave, packaging, the draft's log, starters, lines of `rubric.md`. Do not build any of them, even partly.

## After this slice

Owed, not optional (David, 2026-11-25: they are fundamental), and in the design already:

- Problems: the underline, the label at the line's end, and the message with its one fix on the caret's line.
- An image setting's row, with a file dropped on it or chosen.
- The menu from a right-click on a part in the page.
- First run, as an introduction and not an error (David, 2026-11-25): what the Jev key adds, shown moving; how to get one; connecting it. The same for the drafting tool: Claude Code and OpenCode now, Codex next, Pi before release. It replaces the design's "No picking key" and "No drafting tool" screens and needs its own design round.

To design, then build:

- **The writer's parts in the catalog** (David, 2026-11-25: once someone uses the app the catalog is theirs, and a part they want everywhere is added to it). Owed around it: the part marked in the catalog as the writer's own, not shipped; a way to show or hide those; the same row and words in Neovim ("Every theme" reads as themes, and means every site); and, before the app is packaged, the writer's additions kept where an update of the shipped catalog does not replace them.
- **The group first, then the rank within it**, as two questions to Jev. Wanted if it holds; only a live probe on real lines can say whether it hits or misses more than one question does (`scripts/probe.ts`, which costs money: ask first). To watch for when testing either way: a ranked list shown under group headings misleads, since the first and fourth best in one group read as that group's two best; that is why the list with words has no headings.

## What exists, verified 2026-11-25

**The app** (`app/src/`, 2,671 lines)

- `menu.rs`: `Menu { title, rows, active, kind }`, `key` (Up, Down, Return or Tab, Esc; anything else passes to the editor) and `place` (under the caret's line or above it, inside the writing pane). `lib.rs:67-111` draws it as a `PopupList`, or for notes a `text_input` in `popover::raised`, anchored to an element at the caret.
- `draft.rs`: `View::parse` (the fields slice 2 reads), `menu_for`, `chose`, `replace` (the answer's line in place, one undo step), `line` (the status line), `peek` (`rubric/peek`: the page draws a part on the line).
- `state.rs`: `State`, `theme()` (three colors from Rune's own tokens), `tab`, `pending`, the ticker. `markdown.rs` makes the spans; headings already take a size and weight.

**Rune** (from a read of the pinned rev; "untested" means nobody ran it here)

- Provided: `popover::raised` and `popover::anchored` with any body; `Segmented` (`rune-kit/src/segmented.rs`); `Button`; `text_input` in a layer; `El::on_secondary_press` with the pointer's place (`rune/src/el/handlers.rs:271`); hover; springs (`El::motion`); `fill`, `radius`, `border`.
- Fonts: `AppSpec.fonts` takes bytes at build time and `families` names the sans and the mono; `TextStyle.family` may be `Family::Named`. A span sets size, weight, color, italic, underline and mono, never a family. So the interface is the sans (Instrument Sans), the writing field is `Named("Literata")` on the element, and code is the mono. Untested: that a named family resolves to compiled-in bytes.
- Untested: whether the editor's own right-click (its copy and spelling menu) comes before the app's handler; two popovers open side by side.
- Not provided: a title bar on Linux; a row's rectangle for a line that is not the caret's (find out in task 1 whether the editor can report one).

**The server**

- `rubric/draft` and its `DraftView` as the first plan listed them (`src/server/main.ts:311`, `src/server/workspace.ts:61-104`): `take`, `takes`, `list`, `of`, `uses`, `catalog`, `variant`, `newVariant`, `change`, `drafter`; actions `build`, `reroll`, `keep`, `cancel`, `stop`, `use`, `take`, `restore`, `remove`, `plain`, `everywhere`, with `variant`, `change`, `to`, `on`, `drafter`.
- `rubric/drafter` and `rubric/harnesses` answer the tools, models and efforts (`main.ts:343-367`). **Read `models` and `installed` in `src/server/harness.ts` before sending either to a real server:** they may run Claude Code or OpenCode. The session sends them only from the recording client; the stub server test leaves them out.
- `rubric/peek` draws a part on a line (`workspace.ts:870`); `#near` ranks the writer's parts for words (`workspace.ts:854`).
- Missing, and task 4 adds them: a placed part's settings with their values, and the catalog as a list.
- With no key Jev's calls answer "could not reach Jev: TYPESAFE_API_KEY is not set" (`src/jev.ts:93`).

## Tasks

In order. Each ends with `cargo test` passing in `app/` (under 30 seconds without `--ignored`), and task 4 with `bun test` and `bun run typecheck`. Tests assert what was sent, what the text became and what is open, never a row's wording beyond its id.

### Task 1: the look

**Files.** `app/src/theme.rs` (new), `app/themes/*.json`, `app/fonts/`, `app/src/lib.rs`, `app/src/state.rs`, `app/src/markdown.rs`, `app/src/main.rs`.

- `theme.rs`: parse an OpenCode theme file and resolve it for a mode, as Pathlight's `resolveRoles` does (hex with 3, 6 or 8 digits, a name in `defs`, another role, an ANSI number, `{dark, light}`; an unknown or circular name is an error). From the roles, the design's ten tokens: `bg`, `pane`, `pop`, `ink`, `ink2`, `ink3`, `line`, `hover`, `accent`, `fail`, a missing one blended from background and text as `derivePalette` does. Read Pathlight's file and its `tests/theme.test.ts` first and port the cases.
- The tokens from the roles. OpenCode's `background` is where the work is, so it is the writing pane, and the bars take the panel:

  | Token | Role, then what stands in when it is missing |
  |---|---|
  | `pane` | `background`; `#ffffff` light, `#141413` dark |
  | `bg` | `backgroundPanel`; `pane` with 4% of `ink` |
  | `pop` | `backgroundElement`; `pane` with 8% of `ink` in dark, `pane` in light |
  | `ink` | `text` |
  | `ink2` | `textMuted`; `pane` with 55% of `ink` |
  | `ink3` | `textFaint` (Rubric's own role); `pane` with 60% of `ink2` |
  | `line` | `line` (Rubric's own); `borderSubtle`; `border`; `pane` with 11% of `ink` |
  | `hover` | `hover` (Rubric's own); `pane` with 6% of `ink` |
  | `accent` | `primary`; `accent` |
  | `on` | `onAccent` (Rubric's own); white or `#111111`, whichever is further from `accent` in luminance |
  | `fail` | `error` |

- The design's four, as files with plain values (no `{dark, light}`); an 8-digit hex is laid over `background`, which is how the design's `rgba` hairlines are written:

  | File | background | backgroundPanel | backgroundElement | text | textMuted | textFaint | line | hover | primary | onAccent | error |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | `paper` | `#ffffff` | `#f6f6f4` | `#ffffff` | `#1c1c1a` | `#66665f` | `#96968e` | `#14140f1c` | `#14140f0e` | `#4257d0` | `#ffffff` | `#b3432c` |
  | `ink` | `#1a1a19` | `#141413` | `#222221` | `#ecece8` | `#9c9c95` | `#6c6c66` | `#fffffa1c` | `#fffffa12` | `#9aa8f7` | `#111111` | `#e2806a` |
  | `sepia` | `#f8f3e9` | `#f1eadc` | `#fcf8f0` | `#3b3228` | `#75675a` | `#a39582` | `#3c2d1426` | `#3c2d1412` | `#9a4a22` | `#ffffff` | `#a8321f` |
  | `fjord` | `#252b35` | `#1e232b` | `#2c333f` | `#e3e7ee` | `#98a2b3` | `#687386` | `#dce6ff1f` | `#dce6ff12` | `#86c5cd` | `#10151c` | `#e58f7c` |

- Rune's `Color` is linear with straight alpha; `rune::color::hex` reads `#rrggbb`. Blend in sRGB bytes as Pathlight's `mix` does, then convert, so the numbers match its tests.
- `app/themes/`: Pathlight's 31 OpenCode files unchanged, with the notice and license beside them, and the design's four written with the Overview's values. They are compiled in; files in `$XDG_CONFIG_HOME/rubric/themes/` are read at start, a later name replacing an earlier, a file that does not parse skipped.
- Every color in the app comes from the tokens; `state::theme()` and the calls to `tok::theme` and `Kit::neutral` for color go.
- Fonts: the variable files of Instrument Sans, Literata and JetBrains Mono, upright and italic, from the `ofl/` folders of github.com/google/fonts at a pinned commit, each with its `OFL.txt`, and a `README.md` in `app/fonts/` naming the commit and each file's SHA-256. `AppSpec.fonts` takes them with `include_bytes!`; `families` is `("Instrument Sans", "JetBrains Mono")`; the writing field's style has `family: Family::Named("Literata")`. Rune says fonts given this way are selectable by name (`rune/src/text.rs:296-300`); find out with a headless render that the writing is not drawn in the sans, and if it is, say so and stop the task there.
- Type, from the Overview's table: writing Literata 17/1.7, H1 30, H2 22, interface Instrument Sans 13, captions 12, the `:::` and Markdown markers in `ink3`.
- The title row (40 points, a hairline under it): the post's first heading or its file name, then "Saved" when the text is as written.
- The status line as the design's: 34 points, a hairline over it, a label in the state's color, one fact in `ink2`, and at most one action with its key. Its states are task 3's.
- A `new:` line's edge (dotted, dashed, solid, by state) and its label at the line's right, if the editor can say where a line is; if it cannot, say so in the findings and leave both to the status line.

**Tests.** Each of the four themes resolves in its mode to the Overview's ten values (the values are the requirement); every bundled theme resolves in both modes; a circular name is refused; a role given as `{dark, light}` follows the mode; a writer's file replaces a bundled one of its name and a broken one is skipped. Headless: the title row shows "Saved" only when clean.

### Task 2: the panel

**Files.** `app/src/panel.rs` (new; `menu.rs` goes when nothing uses it), `app/src/lib.rs`, `app/src/editor.rs`.

A panel is a list of rows: `Item` (label, and any of a note, a chip, a key, a check, a "more" mark, a danger color), `Sep`, `Head` (a name and a note), `Seg` (a label and choices, one on), `Field` (with or without a label), `Title`, `Text`. Heights and widths are the design's (`I` 30, `S` 9, `H` 26, `G` 32, `F` 36).

The model is plain data with no Rune in it, so the tests need no window: `Panel { id, rows, active, width }`, each row with an `id` the owner matches on, and `State` holding a stack of at most two panels in place of `menu`. `panel::key(&mut stack, &KeyEvent) -> Taken` answers `Moved`, `Chose(id)`, `Set(id, value)` for a segment, `Submitted(id, text)`, `Back`, `Closed` or `Passed`; whoever opened the panel acts on it. The view turns rows into elements: Rune has `Segmented` (`rune-kit/src/segmented.rs:20-80`), `text_input` in a layer (as `lib.rs:82-94` does now), `popover::raised` and `popover::anchored` (`rune-kit/src/popover.rs:20-53`), hover and press on any element, and springs (`El::motion`, `rune/src/el/motion.rs`). Draw the segments from `el` and `row` if `Segmented` cannot be made to look like the design's. A field is one `TextEdit` in `State` at a time, as `notes` is now.

- Keys: Up and Down move over the rows that take the focus (`Item`, `Seg`, `Field`); Left and Right change a `Seg`; Return chooses an `Item` or submits a `Field`; a row's own key chooses it from anywhere in the panel; Esc goes back one panel, then closes; typing in a `Field` stays there; any other key closes the panel and is the editor's.
- The pointer: over a row makes it the active one; a press chooses it, or the segment under it.
- A second panel opens beside the first at its row; when the pane is too narrow for both it takes the first's place, with the first's name as a top row that goes back. A panel that does not fit under its line opens above it. Nothing is drawn right of the writing pane.
- Opening and closing use the design's spring (fade, and scale from 0.98).
- The panel's first use is the list of app themes (see Decisions), each row a name and, for the writer's own, a note: moving sets the app's theme, Return writes the choice, Esc sets the one before.

**Tests.** Headless: moving in the theme list changes the tokens the view draws with; Esc restores them and writes nothing; Return writes the name to a config folder the test owns, and a new `State` reads it. The key model row by row (which rows take the focus, a `Seg` at its ends, a row's key from another row, Esc with two panels). `place` for under, above, beside and replaced, each inside the pane. Headless: a press on a segment reports that segment; the editor keeps its text while a `Field` is typed in.

### Before task 3: what the review of sitting 1 found

Sitting 2 starts with two steps of housekeeping, then the fixes.

- **Commit sitting 1.** Everything `git status` shows on `slice-3`, as one commit: `Add the app's themes, fonts, title and status bars, and the panel with the theme list.` One plain sentence, no body, no trailers, no Co-Authored-By. David asked for this commit and the next (2026-11-25); the rule against committing holds for everything after them.
- **Remove the drafts left in the app's site by testing.** `git rm -r sites/app-slice/parts/tide-clock`, and delete `sites/app-slice/parts/` and everything in `sites/app-slice/.rubric/drafts/`. Run `git status` first and stop if `sites/app-slice/` holds changes other than these. Nothing under `testing/` is touched: its parts and drafts are David's own. Then run `cargo test -- --ignored` in `app/` (the stub, no Jev): both must pass. Commit: `Remove the drafts testing left in the app slice's site.`

The fixes, each with a test that fails without it:

1. **Light or dark is chosen in the list of themes.** Drawn light by default, Dracula, Monokai, Tokyonight and most of OpenCode's themes are their light halves, which nobody means by those names and which are weak (Monokai's accent on its light background is 1.6 to 1). The list of themes gets a `Seg` as its first row, `Mode` with `Light` and `Dark`: changing it redraws the theme under the focus at once, Return keeps the mode with the theme in `app.json` (`"mode": "dark"`), Esc restores both. `RUBRIC_APP_MODE` still wins for one run. With nothing kept the mode is light, since Paper is the start. This replaces the "Light or dark" row of the decisions.
2. **A still pointer chooses nothing.** Rune refreshes hover on every build (`runtime/paint/build.rs`, `refresh_hover`), so a panel that opens, or scrolls by the keys, under a resting pointer may move its focus to the row there, and in the list of themes that draws another theme. Find out with a headless test (the pointer placed where the list will open, then Ctrl+,: the theme and the row with the focus must not change; then Down past the list's end with the pointer still). If it does, `look::hovered` acts only after the pointer has moved since the panel opened or last scrolled.
3. **Ctrl+, with the list open closes it.** Now the panel passes the key, closes, and `editor::key` opens it again.
4. **Left on a second panel goes back; Right on an item with `more` chooses it.** Now both close the panels and move the caret.
5. **A writer's theme file that is skipped says why**, once, on stderr (`theme mine.json: color reference "x" is not in defs or theme`), and only the roles the tokens read are resolved, so a role this app never uses (a number that is no color, a key OpenCode adds later) does not cost the writer the theme.


**Files.** `app/src/draft.rs`, `app/src/state.rs`.

The `new:` line's menus as panels, from the design's `menu`, `draft-running`, `draft-ready`, `takes`, `draft-failed`, `new-part` and `reroll-notes`:

- Not started: "Draft" with the drafter's chip, "Similar parts (N)" when there are any (the page draws the one looked at, as now), "Earlier takes (N)" when there are.
- Drafting: "Stop". Ready: "Keep", "Reroll" with the chip, "Reroll with changes…" (a field, then "Reroll" with the chip), "Takes (N)" when N is 2 or more, "Cancel". Failed: the message as a title and a sentence, "Reroll", "Reroll with changes…", "Cancel".
- Takes: a list from `view.list`; moving sends `take` with `to`; Return stays on that take; Esc sends the take that was shown and goes back.
- The chip opens one panel: the tools (`rubric/harnesses`), the chosen tool's models (`rubric/drafter`), and effort as a `Seg`. What is chosen rides on the next `build` or `reroll` as `drafter` and names the chip; nothing is saved, and the next line starts from the default.
- The status line: drafting with the seconds and "Stop", ready with "Keep", failed with the reason and "Reroll", kept and removed for 4 s with nothing to press.

**Tests.** The rows' ids for each state of the view, "Takes" only from two. Headless with the recording client: moving in Takes sends one `take` a row; Esc sends the first shown; the drafter chosen rides on `build` and on `reroll` and not on the next line's; Esc in the drafter's panel sends nothing. Stub server test: build, reroll, `take` with `to: 1` answers `take: 1`; keep answers the part's line.

### Task 4: what the server answers about parts

**Files.** `src/server/main.ts`, `src/server/workspace.ts`, a test beside the server's others, `docs/lsp.md`.

- `rubric/part` `{ uri, line }`: for a line that places a part, its name, whether it is the catalog's, the site's own or a variant (and of what), how many blocks use it, and its settings in the catalog's order, then the four look settings: each with its type, its values, its default and the line's value. With `set: { name, value }` it answers `{ replace }`, the line with that setting set (dropped when the value is the default); a name or value the part does not have answers `{ error }`. Nothing is written but the answer.
- `rubric/parts` `{ uri, words? }`: the site's own parts, then the catalog's for the page's kind, each with its name and description; with words, in Jev's order with the ones under the `near` threshold left out. No words asks Jev nothing.
- Names are the catalog's; the app makes them readable ("tide-table" reads "Tide table").
- The answer's shape, for `::: quote size=large` (a setting's `value` is absent when the line does not set it):

  ```json
  { "name": "quote", "kind": "catalog", "uses": { "blocks": 3, "pages": 2 },
    "settings": [
      { "name": "size", "type": "choice", "values": ["normal", "large"], "default": "normal", "value": "large" },
      { "name": "cite", "type": "text" } ],
    "look": [
      { "name": "shadow", "type": "choice", "values": ["none", "soft", "deep"], "default": "none" } ] }
  ```

  `kind` is `catalog`, `own` or `variant`; a variant adds `"variant": { "of": "quote", "name": "torn-edge", "everywhere": true }`. A line that places no part answers `null`.
- `catalogs/universal/catalog.yaml`: a `group` on each part for the writing, as below (David may move any). It is not sent to Jev: check that in `src/core/questions.ts` and the fixtures before deciding the version stays. `rubric/parts` answers each part's group; a site's own part has none and is listed under "Own".

  | Group | Parts |
  |---|---|
  | Writing | lead, quote, callout, sidenote, glossary, fold, divider |
  | Layout | section, hero, columns, tabs, cards |
  | Lists and steps | steps, timeline, contents, post-list |
  | Media | figure, gallery, video, audio, embed, map, pdf |
  | Data and code | table, chart, stats, progress, code, diagram, math, file-tree |
  | People and business | testimonial, people, logos, pricing |
  | Actions | call-to-action, buttons, download, contact-form, subscribe |

**Tests.** `bun test` with the stub resolver: a `::: quote size=large` line answers `size` with value `large` and `shadow` with its default; `set` to the default drops the setting and keeps the others in place; an unknown value is refused; `rubric/parts` with no words lists own parts first and calls no resolver.

### Before task 5: what the review of sitting 2 found

Sitting 3 starts by committing sitting 2 if `git status` still shows it (`Fix the theme list's review findings, draw the draft menus as panels, and add the server's part and parts requests.`, one sentence, nothing else), then these two, each with a test:

1. **A tool that is not installed cannot be chosen.** In the drafter's panel its row keeps "Not installed", takes no focus from the keys and does nothing on a press. Now it can be chosen and the draft fails.
2. **`rubric/part` with `set` takes a text and a number setting**, and refuses a number that is none: `test/part-request.test.ts` sets choices only.


**Files.** `app/src/part.rs` (new), `app/src/draft.rs`, `app/src/state.rs`, `app/src/ghost.rs`.

Tab or a right-click on a part's line asks `rubric/part` and `rubric/draft` (no action) and opens the design's `part-menu`:

- The part's settings, then "Look": a choice is a `Seg` (more than four values, a second panel of items), text a `Field`. A change sends `set` and puts the answer's line in place, one undo step each; the page follows as it does for typing.
- The words field (see Decisions).
- "Change…": a field and "Draft variant" with the chip; Return rewrites the line as Neovim's `new_variant` does (`editors/nvim/lua/rubric/drafts.lua:441-449`) and sends `build` with `variant: true`. A pick whose pin has `change: true` opens this panel on Tab.
- While a variant drafts, "Stop" and "Back to <part>"; ready, the ready rows with "Back to <part>" for "Cancel".
- "Takes (N)" and "Reroll" on a site's own part or a variant; "Add to every site" on a site's own part (not a variant: the server refuses one); "Every <part> as <name>" or "Every <part> plain", and "Back to <part>", on a variant.
- Last: "Remove" on a catalog part (see Decisions), or "Remove…" on an own part or a variant, whose second panel is titled with the blocks that use it and reads "Keep", "Remove from this block", "Remove from site".

**Tests.** The rows' ids for a catalog part, an own part, a variant with `everywhere` on and off, a variant drafting and ready. Headless: a segment sends `set` with its name and value and nothing else; Remove… sends nothing until the second panel's choice; "Remove" on a catalog part keeps the block's writing; undo after a setting restores the line. Stub server test on a temp site: Change… on `::: quote` with "torn edge" gives a ready variant, keep answers its line (check it against the server), "Back to quote" puts the line back; keep a part, reroll it on its own line, remove it, and the temp site's `parts/` follows.

### Task 6: insert, and a line of words

**Files.** `app/src/insert.rs` (new), `app/src/editor.rs`, `app/src/state.rs`.

- Tab on an empty line, or a right-click on writing: "Insert part…", "New part…", then Cut, Copy and Paste (Cut and Copy dim with nothing selected). Find out first whether the editor's own right-click menu comes before the app's; if it does and cannot be turned off, say so and keep Tab.
- "Insert part…": a field over a list. Empty, the list is `rubric/parts` under its groups, "Own" first; with words it is flat, and it is asked again 250 ms after the last key and the answer for older words is dropped. Moving draws that part on the caret's line (`rubric/peek`); Return writes `::: <name>` there; the last row, "Draft new part", writes `::: new: <words>` and starts the draft; Esc leaves the text and the page as they were.
- "New part…": a field; Return writes `::: new: <words>` and opens task 3's menu.
- On a `:::` line of words that is no part: the pick (Tab takes it, as now), "Similar parts (N)", "Draft new part" with the chip.

**Tests.** Headless: typing in the field sends one `rubric/parts` after the pause, not one a key; an answer for older words changes nothing; moving sends `rubric/peek` with the row's part and Esc sends it with none; Return writes the line in one undo step; "Draft new part" writes the `new:` line and sends `build`. Stub server test: insert `quote` on an empty line and the server's text has it.

### Task 7: measure, and write it down

`docs/app-slice-findings.md` gains "Slice 3": slice 2's budgets rerun (typing p95 4 ms, Tab to menu 50 ms, a menu key one frame, idle under 1%), a segment's press to the line's change, what the panel needed that Rune lacked, each "untested" above answered, and what no one saw. `testing/TESTING.md` gains section C, one row a test and few of them, started natively, with the line that undoes what the rows write. `CLAUDE.md`'s State and `docs/plan.md`'s "Order of work" say where the app stands.

## Rules for the session

- No call to Jev, no real drafts, no bench runs, no probes. Never pass `--live` or set `LIVE`. Never read `.env`. Real drafts are David's rows.
- Never send `keep` with `global: true`, nor `remove`, to a server whose site or catalog is not a copy in a temp folder.
- No window on David's display unless he says so. Don't touch `testing/` or a site process the session did not start.
- Change nothing outside `app/`, the server files task 4 names, `docs/lsp.md`, `docs/app-slice-findings.md`, `testing/TESTING.md`, `CLAUDE.md` and `docs/plan.md`.
- Do not commit, but for the two commits "Before task 3" names. After each task, give the one-sentence commit message.
- No reviewer subagent: the session that wrote this plan reviews each sitting's diff. Stop every process the session starts and check that it is gone.

## Decisions the build made

One line each: what was chosen, and why the plan did not settle it.

- Sitting 1 (2026-11-25):
  - Pathlight has 32 OpenCode themes, not 31: all 32 are copied (`app/themes/`), with the design's four, 36 in all. The plan's count was off by one.
  - The list of themes is the design's four first, then OpenCode's in name order; a writer's file with a bundled name takes that theme's place, a new name goes last. Names read as words ("Catppuccin frappe"), and a writer's own carry the note "Own".
  - A writer's file that parses but does not resolve in both modes (a loop, a missing name) is skipped with the broken ones, so a theme never fails once chosen.
  - A theme kept in `app.json` that no longer exists, or a `RUBRIC_APP_THEME` that does not, falls back to the next of: the environment's, the kept one, Paper.
  - The `new:` line's edge and label cannot be drawn (see the findings), so its draft's state stays in the color of its `:::`: the design's `ink3` before a draft, the accent while drafting and ready, the failed color when failed. Every other `:::` is `ink3` and a part's name is the text's color, as the design draws them.
  - The theme list opens at the caret's line, like every panel, 250 points wide; closing it any way but Return (Esc, a typed key, a click in the writing) draws the theme before again.
  - Changes a panel makes (the lit row, a theme drawn) land at once (`Tx::color_motion(Spring::NONE)`): the design says list hover and theme previews change instantly.
  - The writing column is the design's 540 points with 24 of padding a side and 56 above; slice 2's was 720.
  - Headings in the writing are weight 600 with their `#` in `ink3` at 400, and bold is 600, as the design draws them.
  - The status line is drawn only when it has something to say (the design's screens without one have none); its label is still slice 2's mark until task 3 gives it its states.
  - The panel's field is drawn as a field only in the top panel; a panel under a second one shows its text without a field, so there are never two fields keyed alike.
  - `panel::key` answers `Typing` besides the plan's seven, for a key the field's own editing takes.
  - A debug build draws the list of themes headless: `rubric-app <post> --scene themes --snap out.png --at 1`.
- Sitting 2 (2026-11-25):
  - A resting pointer did take a row (the headless test reproduced it: the list opened on Fjord). Rows now follow `on_pointer_move`, which Rune sends only when the pointer moves, in place of hover; the plan's "acts only after the pointer has moved" without a flag to keep.
  - `RUBRIC_APP_MODE` takes `light` as well as `dark`, so one run can be light over a kept dark.
  - Return on the list's `Mode` row keeps the theme drawn, as Return on its row does.
  - Left and Right do what the plan names (Left back from a second panel, Right on a `more` row) and otherwise still close the panels; Right on a row with a chip opens the chip's panel (`Taken::Chip`), and so does a press on the chip.
  - Only the roles the tokens read are resolved: `background`, `backgroundPanel`, `backgroundElement`, `text`, `textMuted`, `textFaint`, `line`, `borderSubtle`, `border`, `hover`, `primary`, `accent`, `onAccent`, `error`.
  - The `new:` line's state is the status line's, as sitting 1 left it, so "Not started" is drawn there too, with `Draft Ctrl+Enter`. The status line's action key works on the line with no panel open (Cmd+Enter drafts or keeps, Cmd+R rerolls, Cmd+. stops), and a press on the action does it; only the action shown has its key.
  - The not-started menu has no Cancel (the design draws none). Reroll and Reroll with changes… on a failed line send `reroll`, which drafts another take as `build` would.
  - Takes: each row's note is its drafter and the change asked for; the server gives no draft's length, which the design's notes show.
  - The drafting panel's heading reads the seconds and the chip; the menu is drawn again each second while it shows, and when the server's word for the line changes (a draft finishing shows Keep in place of Stop).
  - A drafter choice belongs to the line's text and stays until the app closes; Esc in its panel keeps what was chosen there and sends nothing.
  - The server's diagnostic for a failed draft now carries its `message`, so the status line can say why without asking (`workspace.ts`).
  - Kept says "<Name>, added to Own parts" as the design does. Cancel says nothing; Removed is for task 5. An error answer says "Failed" and the error.
  - `rubric/part`'s `uses` counts every block drawing the part, this one with them; its settings leave out Rubric's `variant`, which the variant rows handle.
  - `rubric/parts` lists the catalog's parts in the order of a new top-level `groups` list in `catalog.yaml`, which `src/core/catalog.ts` reads and checks (a file task 4 did not name; without it `group` was dropped). The version stays 13: nothing in a question reads `group`.
  - A press on a panel row gives the keys back to the writing (Rune moved the focus off the editor on a press).
  - The test of "Every theme" (`every_theme_sends_global`) went with the Keep menu it tested; Keep asks nothing now.
