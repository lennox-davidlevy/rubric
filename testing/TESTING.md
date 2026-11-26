# Live test: before the app

What changed in the plan's "Before the app" list (docs/plan.md, under step 8), item by item. Earlier tables: [TESTING-command.md](TESTING-command.md), [TESTING-variants.md](TESTING-variants.md), [TESTING-jev-and-drafts.md](TESTING-jev-and-drafts.md), [TESTING-full.md](TESTING-full.md).

Write what you find in **Notes** at the bottom, by test number.

Last updated: 2026-11-19 (section B, the app's menu and a new part).

## Set up

1. Quit every Neovim, then `git pull` on `main` (or check out the branch named in the commit).
2. Open `testing/pages/posts/walk.md` in Neovim. The notice gives the address.

## T. The full theme check

`look` on all 72 passed; a measure of every theme with a sidebar on either side, at 1100 to 2560px, found the header and footer centered over the writing everywhere but in the five skins whose header is a column of its own down the left (Hyde, Anatole, m10c, Book and Relearn, which Zen and Tome use too): the sidebar rule of 2026-11-16 padded that column by the sidebar's width, so Hyde's name broke a letter a line, Book's and Anatole's header slid out of sight, and the menus were cut. They keep their column now.

| # | Do this | Expect |
|---|---|---|
| T1 | Make `my-garden` as in R9 of TESTING-command.md and add the `::: sidebar` from its S2. Then `::: theme hyde` in `rubric.md`, on a wide screen | The dark column on the far left with the name whole and the menu under it, the sidebar beside it, the writing to the right. |
| T2 | The same in `book`, then `anatole`, then `relearn` | The header column at the far left, its name and links readable, in each. |
| T3 | `::: sidebar side=right` in `hyde` | The dark column still at the far left, the sidebar on the right. |
| T4 | Back to `paper`, sidebar on the left | The header and footer centered over the writing, as before. |
| T5 | `hyde` with the sidebar on the left, and the `::: header` block taken out of `rubric.md` | The site's name still in the dark column at the far left. |

## L. Leftovers from the live tests

Catalog version 13. L1 to L3 ask Jev (a cent or two); L4 and L5 make no calls.

| # | Do this | Expect |
|---|---|---|
| L1 | `::: a big quote from the book`, pause | `quote size=large`, with no `text=bigger` beside it. |
| L2 | `::: a quote in bigger type`, pause | A quote at size large or with `text=bigger`, never both. |
| L3 | On `::: quote`, add ` : big`, pause | `size=large` only. |
| L4 | Make a variant of a quote and keep it (or use one from E in TESTING-variants.md). Put `::: quote variant=<its name>` on two lines of one page and on a line of a second page. On the first line, **Remove**. | The first line goes back to `::: quote`. The other two keep `variant=<name>` with a warning that the site has no such variant, and the page draws all three as plain quotes, not as text. |
| L5 | `::: quote variant=nothing-like-it` on a quote with a variant left | The same warning; drawn as the plain quote. |

Hugo for macOS (`.pkg` only in the release) is unpacked by Rubric now, tested here with a made package and against the real release; on a Mac with no Hugo, a first `rubric` should fetch it into `~/.cache/rubric/hugo/0.169.0/hugo`. Nothing to do on Linux.

## A. The app slice (branch `app-slice`)

Step 9's first slice: the post on the left in Rune, the page on the right in a web view, one pick taken with Tab. The plan is [docs/app-slice.md](../docs/app-slice.md); the findings and numbers are in [docs/app-slice-findings.md](../docs/app-slice-findings.md). Start it with `app/scripts/run-nested.sh` (from anywhere): the app in a Xephyr window with an i3 of its own inside, drawing in software; the site's process starts with it, with the stub (no Jev calls): a pick comes only for a line that names a part (`::: a quote`, `::: a callout`), never from other words. The Xephyr window goes to workspace 6:Slack (`WORKSPACE=` names another, empty leaves it where it opens). The app takes the size the window has a second after it opens (tiled, floated or full screen in your i3); a later change of that size is not followed, so restart the script after one. Closing the Xephyr window, or Ctrl+C in its terminal, stops all of it. Do not open `sites/app-slice` in Neovim: its server is the live one, and a stub process and a live one refuse each other.

**On Omarchy (Hyprland), run it natively:** `app/target/release/rubric-app sites/app-slice/pages/posts/long.md` from the repo, after `cargo build --release` in `app/`; it opens through XWayland, with the stub, and the rows below judge Rune itself. Close the window to stop it; the site's process stops a minute later. What follows is for the Fedora machine with Xorg.

**Never straight on the NVIDIA display.** The app's window crashes Xorg there through a fault in NVIDIA's driver 575.64.05 (the findings, "The Xorg crash"); the nested run keeps its GPU work off the driver. Drawn in software, it is slower than it would be on the GPU, so A2, A3 and A14 judge the software path, not Rune's speed.

| # | Do this | Expect |
|---|---|---|
| A1 | Start the app | Window with the post on the left, ready to type at once; the page on the right within a second. |
| A2 | Type a paragraph fast | Letters appear with no lag; the page gains the paragraph in place. |
| A3 | Hold a key down for five seconds mid-post | No stutter in the editor; the page catches up when the key is released. |
| A4 | Move the caret from top to bottom | The page scrolls to follow. |
| A5 | Drag the divider left, right, and to each edge | Both panes resize together; each edge snaps; dragging back restores both, and typing still goes to the writing. |
| A6 | Start it with the Xephyr window full screen in your i3, then again tiled beside another window | Both panes fill the window each time. (Resizing after it starts is a Xephyr gap; see above.) |
| A7 | Click a link in the page, then click in the editor and type | The page goes there; typing goes to the editor. |
| A8 | On a new empty line type `::: a quote` | A closing `:::` appears below; a dimmed pick after the caret. |
| A9 | Press Tab | The line becomes the part; the page draws it. |
| A10 | After A9, undo once (Ctrl+Z) | The words come back. |
| A11 | Press Tab on a plain line | Nothing changes; the caret stays in the editor. |
| A12 | Ctrl+S, then `cat` the file | It holds what was typed. |
| A13 | Close the Xephyr window, then `pgrep -fa 'rubric-app\|Xephyr\|cli.ts\|hugo server\|WebKitWebProcess'` | Nothing, the site's process and Hugo included (unless the site's process was running before). |
| A14 | Type plain prose in Neovim on a post in `testing/`, and the same in the app | The app feels at least as immediate. This is the row that decides. |

After A12, `git checkout sites/app-slice/pages/posts/long.md` restores the post (once the slice is committed).

## B. The app's menu and a new part (branch `app-slice-2`)

The second slice: Tab on a `::: new: words` line opens a menu at the caret, which drafts the part, keeps it, rerolls it or cancels it; a line under the writing says where the draft is. The plan is [docs/app-slice-2.md](../docs/app-slice-2.md); what was found is under "Slice 2" in [docs/app-slice-findings.md](../docs/app-slice-findings.md). Start it as in A, with `app/scripts/run-nested.sh`. Drafts are the stub's (at once, no cost) unless a row says `LIVE=1`: "slow" in the words makes one take a second, "failing" makes it fail. In a menu: Up and Down move, Return or Tab chooses, Esc closes, any other key closes it and types.

| # | Do this | Expect |
|---|---|---|
| B1 | On a new line at the end of the post type `::: new: a tide clock` | The line is gray. Under the writing: `+ Tab drafts a part`. |
| B2 | Tab | A menu at the caret, inside the writing pane: New part, Draft (the stub), Cancel. |
| B3 | Return on Draft | The line turns blue; under the writing `◆ tide-clock drafted …`; the page draws the part. |
| B4 | Tab, Keep tide-clock, This site | The line becomes `::: tide-clock`; `✓ tide-clock kept` for four seconds; `ls sites/app-slice/parts` has it. Ctrl+Z brings `::: new: a tide clock` back. |
| B5 | `::: new: a brass bell`, draft it, then Tab, Reroll…, Notes…, type `name it tide-two`, Return | A field in the menu's place takes the typing, not the post. Then `◆ tide-two drafted`, drawn in the page. |
| B6 | Tab, Cancel on that draft | The line becomes `::: a brass bell` (no `new:`), as in Neovim; the draft leaves the page. |
| B7 | `::: new: a failing thing`, draft it | The line turns orange; `✗ draft failed · Tab retries`; Tab offers Retry. |
| B8 | Open a menu, then type a letter | The menu closes; the letter is in the writing. |
| B9 | Drag the divider far left, put the caret on a `new:` line, Tab | All of the menu is inside the narrow writing pane; none of it is under the page. |
| B10 | On a new line type `::: a brass gong`, wait for `→ draft a new part`, Tab | The line becomes `::: new: a brass gong` and its menu opens. |
| B11 | Draft a part, then Tab, Keep, Every theme. **Then undo it** (the line under this table) | `✓ … kept for every theme · catalog version N`, one more than before; the line is the part's. |
| B12 | Open and close a menu a few times, and choose Draft, while watching `top` | No stutter; the app's CPU falls back to nothing within a second. (In the nested window it draws in software, so a short burst is expected; this row matters on the native run.) |
| B13 | `LIVE=1 app/scripts/run-nested.sh`, then `::: new: a tide clock`, Tab, Draft (a few cents) | The seconds count up under the writing; a real part in about 22 s, drawn in the page. |
| B14 | `::: new: a quote from the keeper`, Tab | The menu starts with `Similar: quote`. Return on it lists the part; the page draws a quote on the line while it is looked at; Esc goes back to the first menu and the page to the line; Return on `quote` makes the line `::: quote`. |

**After B4 and B11, undo what they wrote.** `git status` shows it. B4: `git clean -fd sites/app-slice/parts`. B11: `git checkout catalogs/universal`, then `git clean -n catalogs/universal` to see the part's new files and `git clean -fd catalogs/universal` to remove them. The post: `git checkout sites/app-slice/pages/posts/long.md` if it was saved.

## C. The designed app (branch `slice-3`)

The third slice: the design's look, one panel for every menu, and the menus in it. The plan is [docs/app-slice-3.md](../docs/app-slice-3.md); what was found is under "Slice 3" in [docs/app-slice-findings.md](../docs/app-slice-findings.md). Start it natively: `cd app && cargo build --release`, then `app/target/release/rubric-app sites/app-slice/pages/posts/long.md`. Ctrl here is Cmd on the Mac.

| # | Do this | Expect |
|---|---|---|
| C1 | Start the app | A 40-point row over both panes: `The long walk` and `Saved`. The writing in a serif (Literata), the row in a sans (Instrument Sans). `#`, `**` and `:::` in a light gray. |
| C2 | Type a letter, then Ctrl+S | `Saved` goes at the letter and comes back at the save. |
| C3 | Ctrl+, then Down and Up a few times | A list of themes at the caret, inside the writing pane, Paper checked. Each move draws the whole app in that theme at once. |
| C4 | Esc; then Ctrl+, again and type a letter | Esc: the theme from before, nothing kept. The letter: the list closes, the theme from before, the letter in the writing. |
| C5 | Ctrl+, move to Ink, Return; quit and start again | Ink stays, and is there after the restart. |
| C6 | Copy `app/themes/nord.json` to `~/.config/rubric/themes/mine.json`, restart, Ctrl+, | `Mine` is last, with `Own`. The pointer over a row draws that theme; a click keeps it. `RUBRIC_APP_THEME=fjord` before the command starts in Fjord for that run only. |

| C7 | Ctrl+, then Up to `Mode`, Right, Down to Ink, Return; quit and start again | `Mode` is the first row. Right draws the app dark at once. Ink in dark after the restart. |
| C8 | Ctrl+, Esc, leave the pointer where the list was; Ctrl+, again, then Down past the list's end | Nothing changes under the still pointer. Moving it over a row draws that theme. |
| C9 | Ctrl+, twice | The list closes; the theme from before. |
| C10 | Put a broken file in `~/.config/rubric/themes/` and start from a terminal | One line on stderr names the file and why it was skipped. |
| C11 | On an empty line type `::: new: a tide clock`, then Tab | Under the writing: `Not started`, the words, `Draft Ctrl+Enter`. A panel with `Draft` and its chip. |
| C12 | Click the chip, choose a model, Right on `Effort`, Esc | A second panel beside the first: tools, models, effort. The chip names the choice. |
| C13 | Return on `Draft` | The status line counts the draft with `Stop Ctrl+.`, then reads `Ready` with `Keep Ctrl+Enter`. |
| C14 | Tab, `Reroll with changes…`, type `name it tide-two`, Return; when ready, Tab, `Takes (2)`, Up and Down, Esc | The words go into the field, not the writing. Each move draws that take in the page; Esc draws the one shown before. |
| C15 | Ctrl+Enter | The line becomes `::: tide-two`; `Kept` shows for 4 s. |
| C16 | `::: new: a failing bell`, Ctrl+Enter, then Tab | The status line names the failure and its reason, with `Reroll Ctrl+R`. The panel shows both above `Reroll`. |

C11 to C16 run with the stub, so nothing is paid for. A tool or model chosen in C12 is only checked, never run.

**After C5 to C16, undo what they wrote:** `rm ~/.config/rubric/app.json ~/.config/rubric/themes/mine.json`, the broken file from C10, then `git checkout sites/app-slice/pages/posts/long.md && rm -rf sites/app-slice/parts sites/app-slice/.rubric/drafts/*`.

## Notes
App starts well
A2 - so there is a bit of a delay in the typing, and if we can get it instant or as close to that woudl be a priority.

The rest is fine, i didnt complete it, but its too early to really test

