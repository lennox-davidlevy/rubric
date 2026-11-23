# The app: slice 3, the rest of the draft menus

Written 2026-11-20, after David ran slice 2 ([app-slice-2.md](app-slice-2.md), section B of `testing/TESTING.md`) in the nested window and said it looks good; slices 1 and 2 are on `main` (PR #9). It adds what slice 2 left out of the menus: the takes of a draft, the menu on a part's own line (another take, Change… into a variant, remove), and the drafter for one draft.

Updated 2026-11-22. David is on Omarchy now (Arch, Hyprland on Wayland, NVIDIA), where the app runs natively through XWayland with no crash, and the editor is instant there: a key to its frame in about 1 ms (the findings, "The native run on Omarchy"). That was the question the verdict on Rune waited on, so this slice goes ahead on Rune. The page lagging behind typing is the server's and Hugo's, noted in the plan under step 9, and not this slice's.

How the session checks its work here: with the tests (the headless `Runtime`, and the stub server on a temp site). There is no private display on this machine (no Xvfb, Xephyr or i3) and the session opens no window on David's display unless he says it may; David looks at the window himself, with `app/target/release/rubric-app sites/app-slice/pages/posts/long.md`. The findings say plainly what no one saw. `app/scripts/run-nested.sh` is for the Fedora machine and does not run here.

Rune's source, to read: `~/.cargo/git/checkouts/rune-*/0ca0756/` (cargo's checkout of the pinned rev); `reference/rune` is not on this machine.

## Decisions, made here (David may overrule any)

| Decision | Choice | Why |
|---|---|---|
| Branch | `app-slice-3`, from `main` | Slices 1 and 2 are merged |
| When Tab asks about a part's line | On any `:::` line that is not a `new:` line and shows no pick that acts: one `rubric/draft` with no action; a menu only if the answer has `of` | Neovim knows a part's line from `rubric/starters`; the app does not read that yet, and one small request on an idle Tab costs nothing seen |
| Takes | A list, as Neovim's: moving draws that take in the page, Return stays on it, Esc goes back to the one that was shown | No keys for next and previous take in this slice: Alt with a letter types a character on a Mac |
| Change… and a reroll's notes | The one-line field slice 2 made for notes | One field, one behavior |
| Remove | A second menu, "Keep" first and "Remove" second, its title saying how many blocks use the part | Neovim's, and the safe row is the first |
| Draft with… | Tool, then model, then effort, each a menu from the server's lists; no list of recent drafters | Neovim keeps recents in a file of its own; the app has no settings file yet, and that is not this slice's to design |
| The draft's log | Not in this slice | It needs a pane or a window; the status line says where the draft is |
| Fill starter | Not in this slice | Starters are their own slice |

Not in it either: lines of `rubric.md`, themes, hover, completion, other diagnostics, the drawer, Sites, Appearance, Publish, autosave, packaging. Do not build any of them, even partly.

## What exists, verified 2026-11-20

Line numbers are from `main` at `2493ab0`. Read each before relying on it.

**The server**

- `rubric/draft` takes `action`: `build`, `reroll`, `keep`, `cancel`, `stop`, `use`, `take`, `restore`, `remove`, `plain`, `everywhere`; and `change`, `global`, `variant`, `on`, `step`, `to`, `part`, `drafter: { harness, model?, effort? }` (`src/server/main.ts:307-336`). `drafter` counts only on `build` and `reroll`, and is checked first (`modelProblem`); a bad one answers `{ error }`.
- `take` with `to: n` (from 1) or `step: 1 | -1` draws that take in the page and answers the view.
- The view (`DraftView`, `src/server/workspace.ts:61` on) has, beyond what slice 2 reads: `take`, `takes`, `list: { at, by?, change?, original? }[]` (oldest first; `original` is the part as kept), `log`, `of` (the line is a part's own: its name), `uses: { blocks, pages }`, `catalog` (the part is the catalog's), `variant: { of, name, everywhere?, catalog? }`, `newVariant` (the takes are of a new variant of this part), `change: { words, colon }` (words after the line's `:` and the column of the `:`), `drafter`.
- On a part's own line the notes are the same three codes, `drafting`, `draft-ready`, `draft-failed`, with `data.of`, `data.variant`, `data.take`, `data.takes`, `data.shown` (`workspace.ts:1352-1375`). Check that `draft::statuses` reads them on a line that is not a `new:` line before building on it.
- `rubric/drafter` `{ harness?, model? }` answers `harness`, `model`, `effort`, `short`, `harnesses`, `models`, `suggested`, `efforts`, `error?`; `rubric/harnesses` answers each tool and its version, or none (`main.ts:343-367`). **Read `models` and `installed` in `src/server/harness.ts` before sending either to a real server:** they may run Claude Code or OpenCode to list models. If they do, the session sends them only from the recording client in headless tests, and the stub server test leaves them out.
- A pick may carry `change: true` in its pin (`workspace.ts:51-53`): accepting leaves the line and opens the part's menu, where Change… starts with the words after `:`. `app/src/ghost.rs` has `build`; add `change` beside it.
- The stub (`src/server/stub.ts:72-118`): another take of the site's own part keeps its name; a variant is named `<part>--<two words>`; "name it x" in a change renames the take; "no settings" drops the setting; "slow" and "failing" as before. With `--stub` the view's `drafter` reads "the stub, as …" when a drafter was sent (`main.ts:157-160`), so a test can see it arrive.

**Neovim's flow**, to mirror (`editors/nvim/lua/rubric/drafts.lua`)

- `takes_list` (`:228-254`): each row "take 2" (or "as kept", "as it was" for the original), when it was made, what drafted it, the change asked, "(now)" on the one shown.
- `M.act_own` (`:389-577`) is the menu on a part's line. Its entries and when each shows are lines `:450-493`; its title, `:494-501`; what each sends, `:502-575`. Mirror it entry for entry, less "Fill starter" and "Log". In short: Wait and Stop while drafting; "Keep this take" on a take that is not the first; "Takes (N)"; "Reroll…" or "Retry…" (not on a catalog part with nothing drafted); "Change…"; for a variant, "Every quote as torn-edge" or "Every quote plain", "Back to quote", "Remove …"; for a site part, "Add name to every theme" and "Remove …"; "Back to …" when anything is drafted.
- Change… (`new_variant`, `:441-449`): the line becomes `<line up to its ":"> : <words>`, then `build` with `variant: true`.
- A reroll on a part's line cuts the words after `:` from the line as it starts, unless they are a new variant's (`reroll`, `:428-438`).
- Which line gets the menu (`editors/nvim/lua/rubric/init.lua:676-693`): a part with `fixed` has no variants and gets a note, not a menu; find what the view answers for one and say the same in the status line.
- `first_menu` and `reroll_menu` (`drafts.lua:1043-1104`): "Draft with…" chooses a drafter and comes back to the first menu, whose Draft row then names it; a reroll's "Make changes…" holds notes and a drafter.

**The app** (`app/src/`): `draft.rs` (the view, the menus, `replace`, the status line), `menu.rs` (the menu and where it goes), `state.rs` (`tab`, `pending`, the ticker), `lib.rs` (the layer the menu is drawn in). The findings' "Slice 2" says what Rune's `PopupList` does and what the app does itself.

## Tasks

In order. Each ends with `cargo test` passing in `app/` (under 30 seconds without `--ignored`). Tests assert what was sent, what the text became and what is open, never a menu's wording beyond a row's id.

### Task 1: takes

**Files.** `app/src/draft.rs`, `app/src/menu.rs`, `app/src/state.rs`.

The ready menu gains "Takes (N)" when `takes > 1`. It opens a list from `view.list`; moving sends `take` with `to`; Return closes on that take; Esc sends `take` with the one that was shown, then reopens the menu before.

**Tests.** `menu_for` has the row only with more than one take. Headless: moving sends one `take` a row with the row's number; Esc sends the first take's number and reopens the ready menu; the text never changes. Stub server test: build, reroll, then `take` with `to: 1` answers a view with `take: 1`.

### Task 2: the menu on a part's line

**Files.** `app/src/draft.rs`, `app/src/state.rs`, `app/src/ghost.rs`.

Tab on a part's line asks for the view and opens `M.act_own`'s menu from it. Reroll, keep (this site only when the part is the catalog's or a variant), stop, cancel ("Back to …"), remove with its second menu, "Add name to every theme", `everywhere` on and off, `plain`. An answer with `replace` goes through `draft::replace`; `removed` and `version` show in the status line for 4 s. The status line reads the three codes on a part's line.

**Tests.** `own_menu` for each case in `drafts.lua:450-493`: a site part with nothing drafted, a catalog part, a variant (everywhere on and off), drafting, ready on the first take and on a later one, failed, a new variant. Headless: Tab on a plain part's line sends the look; an answer with no `of` opens nothing; Remove sends nothing until the second menu's Remove. Stub server test on a temp site: keep a part, reroll it on its own line, keep the take, remove it; the temp site's `parts/` follows.

### Task 3: Change…

**Files.** `app/src/draft.rs`, `app/src/state.rs`.

"Change…" opens the field, filled with the words after the line's `:` when there are any; Return rewrites the line as Neovim's `new_variant` does (one undo step) and sends `build` with `variant: true`. A pick with `change: true` opens the part's menu on Tab.

**Tests.** The line after Change… for a line with and without words after `:`; undo restores it. Stub server test: Change… on `::: quote` with "torn edge" gives a ready variant named `quote--torn-edge`, keep answers `::: quote variant=torn-edge` (check the exact line against the server, not this sentence), "Back to quote" puts the line back.

### Task 4: the drafter for one draft

**Files.** `app/src/draft.rs`, `app/src/state.rs`.

"Draft with…" in the first menu and a drafter row beside Notes in the reroll's: tool, model, effort, from `rubric/harnesses` and `rubric/drafter`; then back to the menu, whose Draft or Reroll row names the choice and sends `drafter` with it. Nothing is saved.

**Tests.** Headless with the recording client only: the three lists ask what `pick_tool`, `pick_model` and `pick_effort` ask; the chosen drafter rides on `build` and on `reroll`; Esc at any list goes back one with nothing sent; the next draft on another line has no `drafter`.

### Task 5: measure, and write it down

`docs/app-slice-findings.md` gains "Slice 3": slice 2's budgets rerun (typing p95 4 ms, Tab to menu 50 ms, a menu key one frame, idle under 1%); what the menus needed that Rune lacked; what was not tried. `testing/TESTING.md` gains section C, one row a test and few of them (David is not deep testing until the app is further along), started natively, with the line that undoes what the rows write. `CLAUDE.md`'s State and `docs/plan.md`'s "Order of work" say where the app stands.

## Rules for the session

- No call to Jev, no real drafts, no bench runs, no probes. Never pass `--live` or set `LIVE`. Never read `.env`. Real drafts are David's rows.
- Never send `keep` with `global: true`, nor `remove`, to a server whose site or catalog is not a copy in a temp folder.
- No window on David's display unless he says so. Don't touch `testing/` or a site process the session did not start.
- Change nothing outside `app/`, `docs/app-slice-findings.md`, `testing/TESTING.md`, `CLAUDE.md` and `docs/plan.md` (task 5). `sites/app-slice/` gains no `parts/`.
- Do not commit. After each task, give the one-sentence commit message.
- The reviewer once, when task 5 is done. Stop every process the session starts and check that it is gone.
