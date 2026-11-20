# The app: slice 2, a menu and a new part

Written 2026-11-18, after David ran the first slice ([app-slice.md](app-slice.md), findings in [app-slice-findings.md](app-slice-findings.md)) in a nested window and said it looks good. It adds the first thing the first slice could only show: Tab on a `::: new: words` line drafts a part, draws it in the page, and keeps, rerolls or cancels it, from a menu at the caret.

It does not wait for the verdict on Rune. That verdict needs a native run (section A, row A14), which waits for a machine where the NVIDIA driver does not crash Xorg. This slice adds a second question to it: can Rune carry the app's menus? If the verdict is no, the menu code is thrown away with the rest and this plan's "What exists" stays true for the next shell.

## Answered by David, 2026-11-19

1. **Every theme.** The menu has the entry. It is for testing, so it stays, as long as the live test has a step that removes what it wrote (row B11 and the line under the table). The session never sends it on the repo's catalog.
2. **Real drafts.** The session uses the stub drafter only, which costs nothing. A real draft (Opus low, about 22 s and a few cents) is a row of David's, through `LIVE=1 app/scripts/run-nested.sh`. The session never sets it.

## What the slice is

On a `::: new: a tide clock` line, a quiet line at the bottom of the writing pane says what Tab does. Tab opens a menu at the caret. The menu drafts the part, and the same line says "drafting" with the seconds. The page draws the draft when it is ready (the server does this already). Tab again offers Keep, Reroll and Cancel. Keep puts the part's line in place of the `new:` line.

Not in it: choosing the drafter or tool use (Draft with…), the list of takes and moving between them, the draft's log, Change… and variants, lines of the site's own parts, starters, themes, hover, completion, other diagnostics, the drawer, Sites, Appearance, Publish, autosave, packaging, the Mac, Wayland. Do not build any of them, even partly.

## Decisions, made here

| Decision | Choice | Why |
|---|---|---|
| Branch | `app-slice-2`, from `app-slice` | The first slice is not merged until its native run |
| The menu | `rune_kit::PopupList`, anchored to an invisible element placed at the caret's rectangle | It takes no keyboard focus, so the editor keeps focus and the caret; the app moves `active` from the editor's key handler (`crates/rune-kit/src/popup_list.rs:86-90`) |
| Where it may be drawn | Inside the writing pane only: under the caret's line, above it when there is no room, never wider than the pane less 16 pt | The page is a native window above Rune's surface; anything Rune draws over the page pane is hidden behind it |
| Keys in the menu | Up and Down move; Return or Tab chooses; Esc closes; any other key closes it and goes to the editor | One key opens and chooses, as Neovim's accept key does |
| A menu's title | A first row that cannot be chosen, dimmed | "tide-clock, in the preview" and "Draft failed: reason" carry what the menu is about |
| The line's status | One line at the bottom of the writing pane, for the line the caret is on; a draft that finishes or fails on another line shows there for 4 s | Rune cannot draw lines that are not in the text, and reports no rectangle for a line the caret is not on (`Cx::caret` only) |
| The `new:` line's color | By status, through `markdown::spans`: dim with nothing drafted, accent while drafting and when ready, the warning color when failed | Spans can color bytes that exist |
| Notes for a reroll | One line typed in the menu's place: a single-line field under the title, Return rerolls with it, Esc goes back | The only text a menu asks for in this slice |
| Which line an answer is for | The line's text when the request was sent; the answer goes to the line that reads so now, or nowhere | Mirrors `find` in `editors/nvim/lua/rubric/drafts.lua:37-48`; the writer keeps typing while the server works |
| Drafts in tests | The stub (`src/server/stub.ts:79-118`): at once; "slow" in the words waits, "failing" fails | No tool, no model, no cost |
| Tests' sites | A temp copy of `sites/app-slice` with `themesDir` rewritten to an absolute path, as in the first slice's `app/tests/server.rs` | Keeping writes `parts/<name>/` into the site; the tracked site stays as it is |

## What exists, verified

File and line numbers are from 2026-11-18.

**The server** (`src/server/main.ts`, `src/server/workspace.ts`)

- One request does everything: `rubric/draft` with `{ uri, line, action?, change?, global?, part? }` (`main.ts:311-336`).
  - No `action`: answers the line's `DraftView` (`workspace.ts:61-87`): `words`, `status` (`"drafting"`, `"ready"`, `"failed"`, or none), `name`, `message`, `shown` (a finished draft still drawn while another is made), `takes`, `earlier` (cancelled takes for the same words), `near` (`{ name, description, own }[]`, parts the site has that are near the words), `drafter` (its short name, "the stub" here).
  - `build` starts a draft and answers the view. `reroll` with `change` (the notes, or `""`) drafts another take.
  - `keep` with `global`, `cancel`, `stop`, `use` with `part`, and `restore` answer `{ replace?, drop?, part?, version?, error? }`. `replace` is the line to put in place of the `new:` line; `drop` is the line of the block's closer, to take away with the block's empty lines when the part takes nothing inside. Mirror `replace` in `drafts.lua:51-77` exactly, as one undo step.
- `rubric/drafted` (`main.ts:162`) is sent to every client when a draft changes: `{ status, name?, words, message? }`.
- `rubric/peek` `{ uri, line, part? }` draws a near part on the line in the page while the writer looks at it; no `part` ends it (`main.ts:294-297`).
- The line's status comes as a diagnostic with `source: "rubric"`, a `code` and `data` (`workspace.ts:1325-1350`): `new-part` (`data.status: "none"`, `earlier?`), `drafting` (`data.started`, a time in ms; `shown?`), `draft-ready` (`data.name`, `settings: { name }[]`, `take`, `takes`), `draft-failed`. `data.close` is the block's last line. The first slice ignores `textDocument/publishDiagnostics`; this one reads these four codes and nothing else.
- The pick on a `new:` line carries `build: true` in its pin (`app/src/ghost.rs:62`, `acts` false). The server sends no pick at all for some `new:` lines (David saw none on `::: new: something`), so Tab must not depend on a pick: it acts on any line that matches `^\s*:::+\s*new:` (`drafts.lua:12`).
- With `--stub`, the drafter is the stub harness and Jev is never called (`main.ts:146-149`).

**Neovim's flow**, to mirror (`editors/nvim/lua/rubric/drafts.lua`)

- `M.act` (`:257-387`) asks for the view, then:
  - no words after `new:`: says so, no menu.
  - nothing drafted, `earlier > 0`: "Drafted before" with "Earlier takes (N)" (`restore`) and "New draft" (`build`).
  - nothing drafted: "New part" with "Similar parts (N)" (or "Similar: name" for one) first when `near` has any, "Draft (drafter)", "Draft with…" (not in this slice), "Cancel" (`:1071-1104`).
  - drafting: "Drafting" with "Wait", "Stop" (or "Stop, back to name" when `shown`), "Keep name" when `shown`, "Cancel draft".
  - ready: "name, in the preview" with "Keep name", "Takes (N)" (not in this slice), "Reroll…", "Cancel".
  - failed: "Draft failed: message" with "Retry", "Keep name" when `shown`, "Cancel".
- Keep asks "Keep name for": "This site" (`global: false`), "Every theme" (`global: true`) (`:265-272`).
- Reroll asks "Reroll name": "Reroll" and "Make changes…" (`:1043-1067`). Here: "Reroll" and "Notes…".
- Similar parts is a list, each "name  yours?  description"; moving in it peeks, choosing sends `use` (`:189-216`).
- The status wording is `looks` (`:1200-1243`); the app's is in task 2.

**Rune** (at the pinned rev, `reference/rune`)

- `PopupList::new(key, anchor).open(bool).items(…).active(Option<usize>).width(…).max_height(…).on_active(…).on_choose(|s, id, tx| …).on_close(…).build(&kit, &mut layer)` (`crates/rune-kit/src/popup_list.rs:112-229, 315`). `PopupItem::new(id, label).description(…).disabled(true)`. It pushes into a `layer` vector the view mounts at the root (`crates/rune-kit/src/overlay.rs:5`); read `overlay.rs` and `popover.rs` for how, and `Kit` for the theme it needs. With `on_close` it adds a scrim that closes on a press outside.
- `.anchored(anchor, side, align, gap)` sets the side; `anchored_fit` in `crates/rune/src/el/anchor.rs:55` flips to fit the window, not the pane, so the app chooses the side itself from the caret's rectangle and the pane's.
- The editor's key handler runs before focus navigation and before the field's own editing (the first slice's `editor::key`), so it sees Up, Down, Return, Tab and Esc first.
- Nothing ticks while the app is idle. For the seconds in "drafting 12 s", a thread calls `handle.update` once a second while any draft is running, and stops when none is.

## Tasks

In order. Each ends with `cargo test` passing in `app/` (under 30 seconds without `--ignored`) and every line under "The session checks" true. The first slice's rules for processes and builds stand.

Windows: every check that opens the window runs on the session's own Xvfb with lavapipe and its own i3, with `DISPLAY` named in the command and checked to be the session's server first. Nothing of the session's runs on `:0`. David's rows run through `app/scripts/run-nested.sh`.

### Task 1: the menu

**Goal.** A menu the rest can open: a title, rows, keys, a choice.

**Files.** `app/src/menu.rs`, `app/src/lib.rs`, `app/src/editor.rs`, `app/src/state.rs`.

**Interfaces.**
```rust
// menu.rs
pub struct Menu { pub title: String, pub rows: Vec<Row>, pub active: usize, pub kind: Kind }
pub struct Row { pub id: String, pub label: String, pub note: Option<String> }
pub enum Kind { New, Keep, Reroll, Near, Notes(TextEdit) }
pub fn key(menu: &mut Menu, key: &KeyEvent) -> Taken; // Moved, Chose(id), Closed, Passed
pub fn place(caret: [f32; 4], pane: [f32; 4], rows: usize) -> (Side, f32); // side and width
// state.rs
pub menu: Option<Menu>,
```
`state.menu` is drawn by `view` as a `PopupList` anchored to an element at the caret. `editor::key` hands keys to `menu::key` first while a menu is open.

**Tests.** `place`: under the caret with room; above it near the bottom; never wider than the pane less 16 pt. `key`: Down and Up move and stop at the ends; Return and Tab choose the active row; Esc closes; a letter closes and is passed on. Headless `Runtime`: with a menu open the editor's text and focus do not change on Down or Return; a typed letter closes the menu and lands in the text.

**The session checks.** With a menu opened by a test key (removed after the task) in the Xvfb window: a screenshot shows it under the caret inside the writing pane, with the split at 0.5 and at 0.25; none of it is over the page.

### Task 2: the line's status

**Goal.** The bottom line of the writing pane says where the caret's `new:` line is.

**Files.** `app/src/draft.rs`, `app/src/state.rs`, `app/src/lib.rs`, `app/src/markdown.rs`.

**Interfaces.**
```rust
// draft.rs
pub enum Status { None { earlier: u32 }, Drafting { started_ms: u64, shown: Option<String> }, Ready { name: String, settings: Vec<String> }, Failed }
pub fn statuses(diagnostics: &Value) -> Vec<(u32, Status)>;   // line, status; the four codes only
pub fn is_new_line(line: &str) -> bool;
pub fn says(status: &Status, now_ms: u64) -> (char, String);  // the mark and the words
// state.rs
pub drafts: Vec<(u32, Status)>,
pub flash: Option<(String, Instant)>,   // a draft finished or failed elsewhere
```
What it says, terse, no sentences to the writer:

| Status | Line |
|---|---|
| nothing drafted | `+ Tab drafts a part` |
| nothing drafted, earlier takes | `+ Tab: 2 earlier takes, or a new draft` |
| drafting | `◐ drafting 12 s` (`· name still shown` when one is) |
| ready | `◆ tide-clock drafted · takes pace · Tab keep, reroll, cancel` |
| failed | `✗ draft failed · Tab retries` |
| kept, for 4 s | `✓ tide-clock kept` |

**Tests.** `statuses` reads each of the four codes from a recorded `publishDiagnostics` and ignores every other code and source. `says` for each row above. `is_new_line` agrees with the Lua pattern on six lines, three of each. Headless: the status shows only while the caret is on a `new:` line; `rubric/drafted` with `ready` for another line sets `flash`.

**The session checks.** Against the real stub server on a temp site: typing `::: new: a slow tide clock` shows the first line; the diagnostics arrive and the status follows without a key.

### Task 3: draft, keep, cancel

**Goal.** Tab on a `new:` line does the next thing, as `M.act` does.

**Files.** `app/src/draft.rs`, `app/src/state.rs`, `app/src/editor.rs`, `app/src/lsp.rs` (nothing new on the wire: `request` exists).

**Interfaces.**
```rust
// draft.rs
pub struct View { /* the DraftView fields this slice reads */ }
pub fn menu_for(view: &View) -> Option<Menu>;        // None: no words after new:
pub fn params(action: &str, uri: &str, line: u32) -> Value;
pub fn replace(edit: &mut TextEdit, asked: &Asked, answer: &Value) -> bool; // one undo step
// state.rs
pub pending: HashMap<i64, Asked>,       // request id → what was asked
pub struct Asked { pub line: u32, pub text: String, pub what: What } // Look, Build, Act
```
`state::tab` on a `new:` line sends the view request; its answer opens `menu_for`. Choosing a row sends the action. An answer with `replace` goes through `draft::replace`. An answer with `error` shows in the status line for 4 s. Requests are told apart from the ghost text's by `pending`.

**Tests.** `menu_for` gives the rows above for each of: nothing drafted, nothing drafted with `near`, with `earlier`, drafting, drafting with `shown`, ready, failed; "Draft with…" and "Takes" are absent. `replace`: the line is replaced where its text is now, three lines lower than asked; the closer and the block's empty lines go when `drop` names them; text inside the block stays; nothing changes when the line is gone; one undo restores all of it. Headless with the recording client: Tab on a `new:` line sends `rubric/draft` with no action; a view answer opens the menu; Return on "Draft" sends `build`; an answer for an id not in `pending` is ignored.

**The session checks.** `app/tests/server.rs`, ignored by default, against the real stub server on a temp site: build, then `rubric/drafted` says ready and the temp site's `content/` holds the draft's shortcode; keep for the site answers a line, the editor holds it, and `parts/<name>/part.yaml` exists in the temp site; cancel on a second draft answers the line without `new:` (`::: words`, `workspace.ts:1223`), and the editor holds it. In the Xvfb window: the same by `xdotool`, with screenshots of the menu, of "drafting" (words with "slow"), and of the page drawing the draft.

### Task 4: similar parts, reroll, notes

**Goal.** The rest of the `new:` menus.

**Files.** `app/src/draft.rs`, `app/src/menu.rs`, `app/src/state.rs`.

Similar parts: a menu of `near`, each row the name with "yours" and the description as its note; moving sends `rubric/peek` with the part, closing sends it with none, choosing sends `use`. Reroll: "Reroll" sends `reroll` with `change: ""`; "Notes…" turns the menu into one field, and Return sends `reroll` with what was typed. Stop, Retry and "Earlier takes" are one request each.

**Tests.** Headless with the recording client: moving in Similar parts sends one `rubric/peek` a row and one with no part on Esc; choosing sends `use` with the part; Notes then Return sends `reroll` with the typed words, and Esc goes back to the reroll menu with nothing sent; the editor's text is unchanged by typing notes.

**The session checks.** Against the stub on a temp site: a reroll with notes "name it tide-two" gives a ready draft named `tide-two`; a line with "failing" shows the failed line and Retry drafts again. In the Xvfb window: a screenshot of the notes field inside the writing pane.

### Task 5: measure, and write it down

**Goal.** The numbers, the rows for David, and the nested run with real drafts.

**Files.** `docs/app-slice-findings.md` (a new section, "Slice 2"), `testing/TESTING.md` (a new section, B), `app/scripts/run-nested.sh` (`LIVE=1` passes `--live` to the app, and says so on its first line of output).

| Budget | Limit | How |
|---|---|---|
| Typing with the menu code in | p95 4 ms, as before | The first slice's `typing` binary, rerun |
| Tab to the menu on screen, stub | 50 ms | Timestamps around the view request and the frame that draws the menu |
| A key in the open menu to the frame | one frame | The headless frame cost with a menu open |
| Idle while a draft runs | Under 1% CPU | `top` on the app for 10 s with a "slow" draft held open |

The findings say: each number against its limit; what `PopupList` could and could not do, with what was done instead; anything in Rune that fought the menu; whether the status line at the bottom is enough or the status belongs under the line (which needs something Rune lacks).

## Rules for the session

- No call to Jev, no real drafts, no bench runs, no probes. Never pass `--live` or set `LIVE`. Never read `.env`.
- Never send `keep` with `global: true` unless the catalog in use is a copy inside a temp folder.
- Nothing on `:0`. Every display command names its display.
- Change nothing outside `app/`, `docs/app-slice-findings.md`, `testing/TESTING.md`. `sites/app-slice/` gains no `parts/`.
- Do not commit. After each task, give the one-sentence commit message.
- The reviewer once, when task 5 is done.

## To try by hand (section B of testing/TESTING.md)

Through `app/scripts/run-nested.sh`, stub unless a row says `LIVE=1`.

The rows are in [testing/TESTING.md](../testing/TESTING.md), section B (B1 to B14), as built.

After B4 and B11, the line under that table undoes what they wrote.
