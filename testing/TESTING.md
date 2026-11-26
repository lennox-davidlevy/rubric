# Live test: before the app

What changed in the plan's "Before the app" list (docs/plan.md, under step 8), item by item. Earlier tables: [TESTING-command.md](TESTING-command.md), [TESTING-variants.md](TESTING-variants.md), [TESTING-jev-and-drafts.md](TESTING-jev-and-drafts.md), [TESTING-full.md](TESTING-full.md).

Write what you find in **Notes** at the bottom, by test number.

Last updated: 2026-11-26 (section C, sitting 6 of slice 3).

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
| C1 | Start the app | A row over both panes reads `The long walk` and `Saved`. The writing is a serif (Literata), the row a sans (Instrument Sans). `#`, `**` and `:::` are light gray. |
| C2 | Type a letter | `Saved` goes. |
| C3 | Ctrl+S | `Saved` comes back. |
| C4 | Ctrl+T | A list of themes at the caret, inside the writing pane, Paper checked. |
| C5 | Down, a few times | Each move draws the whole app in that theme at once. |
| C6 | Esc | The theme from before. |
| C7 | With the list open, type a letter | The list closes, the theme from before, the letter in the writing. |
| C8 | Ctrl+T twice | The list opens and closes; the theme from before. |
| C9 | With the list open, Right on `Mode` (the first row) | Paper and Sepia dim; the app stays Paper. |
| C10 | Down | Ink, drawn at once. |
| C11 | Return | The list closes; Ink. |
| C12 | Quit and start again | Ink, dark. |
| C13 | Start again with `app/themes/nord.json` copied to `~/.config/rubric/themes/mine.json` | The app starts as before. |
| C14 | Ctrl+T | `Mine` is last, noted `Custom`. |
| C15 | Move the pointer over a row | That theme is drawn. |
| C16 | Click a row | That theme is kept; the list closes. |
| C17 | With the pointer resting where the list opens, Ctrl+T | The checked theme has the focus; nothing changes under the still pointer. |
| C18 | Up twice, the pointer still | The highlight is on the last theme; nothing changes under the pointer. |
| C19 | Start once with `RUBRIC_APP_THEME=fjord` before the command | Fjord. |
| C20 | Start from a terminal with these in `~/.config/rubric/themes/`: `a.json` reading `not json`, `b.json` reading `{}`, `c.json` reading `{ "theme": {} }`, and `d.txt` | Four lines on stderr, one for each file, each saying why it was skipped. |
| C21 | On a line reading `::: new: a tide clock`, Tab | Under the writing: `Not started`, the words, `Draft Ctrl+Enter`. A panel with `Draft` and its chip. |
| C22 | Tab | The highlight moves down a row, or stays on the last; no draft starts. |
| C23 | Click the chip | A second panel beside the first: tools, models, effort. |
| C24 | Choose a model | The chip names it. |
| C25 | Esc | The second panel closes. |
| C26 | Return on `Draft` | The status line counts the draft with `Stop Ctrl+.`, then reads `Ready` with `Keep Ctrl+Enter`. |
| C27 | In the line's menu, Return on `Reroll with changes…` | A second panel with a field. |
| C28 | Type `name it tide-two` | The letters go into the field, the first one too; the writing is untouched. |
| C29 | Return | Another take drafts; the status line reads `Ready` when it is done. |
| C30 | In the line's menu, Return on `Takes (2)` | The takes, the one shown checked. |
| C31 | Up and Down | Each move draws that take in the page. |
| C32 | Esc | The take shown before is drawn again. |
| C33 | Ctrl+Enter | The line becomes `::: tide-two`; `Kept` shows for 4 s. |
| C34 | On a line reading `::: new: a failing bell`, Ctrl+Enter | When it fails, the status line names the failure and its reason, with `Reroll Ctrl+R`. |
| C35 | Tab | The panel shows the failure above `Reroll`. |
| C36 | On the first line of a quote block (`::: quote`, a line of words, `:::`), Tab | A panel headed `Quote` under the start of the line: `Size` and `Align` as segments, `Cite` and a words field, `Look`, `Change…`, `Remove` in red. The page draws the quote. |
| C37 | Down and Up over every row, ten times each way | The highlight follows every key. |
| C38 | With the panel closed (Esc), type a letter | The letter lands in the writing. |
| C39 | In the quote's menu, Tab and Shift+Tab | Tab moves the highlight down a row, Shift+Tab up; neither chooses. |
| C40 | Right on `Size` | The line reads `::: quote size=large` at once and the page follows; the panel stays where it was. |
| C41 | Ctrl+Z | The line goes back; the panel closes. |
| C42 | In the quote's menu, on `Cite`, type `A. Keeper` | The letters go into the field, the first one too. |
| C43 | Return | The line gains `cite="A. Keeper"`; the panel does not move. |
| C44 | On the words field, type `bigger` | The letters go into the field. |
| C45 | Return | The line ends ` : bigger`, the caret after it, the pick showing. |
| C46 | Tab | The pick is taken. |
| C47 | In the quote's menu, Return on `Change…` | A second panel with a field and `Draft variant`. |
| C48 | Type `torn edge` | The letters go into the field. |
| C49 | Return | The line ends ` : torn edge`; the status line reads `Drafting` with `Stop Ctrl+.`. |
| C50 | Tab | `Stop` and `Cancel`. |
| C51 | Once the status line reads `Ready`, Ctrl+Enter | The line reads `::: quote variant=…`. |
| C52 | Tab | Rows `Every quote as …` and `Revert to original`. |
| C53 | Return on `Revert to original` | The line reads `::: quote` again. |
| C54 | In the quote's menu, Ctrl+Delete | The `:::` lines go, the words inside stay; `Removed` shows. |
| C55 | Ctrl+Z | Both lines come back. |
| C56 | Tab on `::: tide-two` (from C33) | `Custom` in the heading; `Reroll`, `Add to every site` and `Remove…`. |
| C57 | Ctrl+Delete | A second panel titled with the blocks that use it. |
| C58 | Return on `Keep` | The second panel closes. |
| C59 | In `Remove…` (Ctrl+Delete), Return on `Remove from site` | `Removed` once the server has done it; `sites/app-slice/parts/tide-two` is gone. |
| C60 | On an empty line, Tab | `Insert part…`, `New part…`, `Cut` and `Copy` dimmed, `Paste`. |
| C61 | Return on `Insert part…` | The list takes the menu's place: a field, then each group with its count. |
| C62 | Down to `Writing (7)`, then Right | Its parts in a panel beside, each with its description; the page draws `Lead` at the line. |
| C63 | Esc, then Esc | The text and the page as they were. |
| C64 | In `Insert part…`, type `quote` | The list turns flat a moment after typing stops. |
| C65 | Return | `::: quote` and its closer. |
| C66 | On a line reading `::: three numbered steps`, the caret inside the words, Tab | `Steps` first, `Similar parts (N)`, `Draft new part`. |
| C67 | Return on `Steps` | The line reads `::: steps`. |
| C68 | In `Insert part…`, Right on `Media (7)`, Down to `Audio` | `Page restarted`, `audio and video off` for 4 s; the page comes back. |
| C69 | Down to `Video` | The page stays drawn. |
| C70 | Esc | The page as it was. |
| C71 | On an empty line, type `::: audio`, Return, `:::` | The page draws the audio part. |
| C72 | Ctrl+S | `Saved`. |
| C73 | Quit and start again from a terminal | `Page restarted` once; the page draws the audio part. |
| C74 | From another terminal, `pkill -P "$(pgrep -x rubric-app)" -f WebKitWebProcess` | `Page restarted`, `audio and video off`; the page comes back. |
| C75 | The same again within 10 s | `Page stopped` in red with `Reload Ctrl+Shift+R`. |
| C76 | Ctrl+Shift+R | The page comes back; `Page stopped` goes. |
| C77 | Start with `RUBRIC_APP_THEME=paper RUBRIC_APP_MODE=light` before the command | Paper. |
| C78 | Ctrl+T | Ink, Fjord and the other themes with only a dark half are dim. |
| C79 | Down | Sepia; Ink is passed over. |
| C80 | Click `Ink` | Nothing changes. |
| C81 | Up twice | `Mode` has the highlight. |
| C82 | Right | Paper and Sepia dim, Ink and Fjord not; the app stays Sepia. |
| C83 | Up | The highlight goes to the last theme that is not dim. |
| C84 | Down | The highlight is back on `Mode`. |
| C85 | Esc | Paper, light. |
| C86 | On an empty line, Tab, then Return on `Insert part…`, Right on `Writing (7)` | The parts beside the groups. |
| C87 | Left | Back to the groups; the page as it was. |
| C88 | Type `a` | The list turns flat with no groups, at most twelve rows tall, with a scroll bar. |
| C89 | Down twenty times | The rows scroll under the field; the field stays where it is. |
| C90 | Esc | The text and the page as they were. |
| C91 | Drag the divider until the writing pane is about 400 wide, then Tab on an empty line, `Insert part…`, Right on a group | The parts in the groups' place, with `‹ Insert part` on top. |
| C92 | Click `‹ Insert part` | The groups again. |
| C93 | Esc, drag the divider back, then Tab on an empty line near the bottom of the window, `Insert part…`, type `a` | The list opens above the line, twelve rows tall. |
| C94 | Esc. On an empty line with a blank line above it, Tab, `Insert part…`, Right on `Writing (7)`, Down to `Callout` | The page draws a callout holding faded sample text. |
| C95 | Down to `Sidenote`, then Up to `Quote` | Each drawn with faded sample text. |
| C96 | Esc twice, then type `::: section ` (with the space) | A closer appears; the page draws a section holding faded sample text. |

C68 to C73 are for a machine without `gst-plugins-base` and `gst-plugins-good`; C74 to C76 work on any. C77 to C96 are sitting 6: themes with one mode, the list that wraps, Insert part…'s groups, lists of at most twelve rows and the starters. C21 to C67 run with the stub, so nothing is paid for. A tool or model chosen in C24 is only checked, never run. The menus open with Tab; a right-click is still the editor's own menu. Delete is ⌫ on the Mac. Never choose `Add to every site` (C56): it writes the catalog.

**After the rows, undo what they wrote:** `rm ~/.config/rubric/app.json ~/.config/rubric/themes/{mine.json,a.json,b.json,c.json,d.txt}`, then close the app and run `app/scripts/clean-test.sh`, which puts the site back.

## Notes
App starts well
A2 - so there is a bit of a delay in the typing, and if we can get it instant or as close to that woudl be a priority.

The rest is fine, i didnt complete it, but its too early to really test

C10 - didnt see an error either in the app or in the rust cli. ALTHOUGH i do see this error

```sh
(rubric-app:3080967): Gdk-CRITICAL **: 20:36:46.561: _gdk_frame_clock_freeze: assertion 'GDK_IS_FRAME_CLOCK (clock)' failed
page loaded http://127.0.0.1:1415/ 265 ms
page loaded http://127.0.0.1:1415/posts/long/ 321 ms
```


C19 - Tab doesnt traverse the menu, only up/down/ for the rows, and left/right for the values
***NOTES***  the menu is attached to the cursor, so when a new value comes up ie `cite="A. Keeper`, the menu jumps right. I think the menu should render above the cursor but stick there? maybe? or maybe not, i am not sure. do you have a better idea? 

Ok I have to stop because the app stopped recognizing my keyboard inputs. The mouse still works. I was C21 when it happened, i did some of it wrong tbh, so i cant tell you exactly what i did. Also for the table, have all the instructions on the left and what we should expect on the right, its messing me up that there are more instrctions on the right. 

BUT! This is BEAUTIFUL! it works mostly incredibly well holy smokes. Great job so far!

Here are the logs from the rust cli:

```sh
(rubric-app:3080967): Gdk-CRITICAL **: 20:36:46.561: _gdk_frame_clock_freeze: assertion 'GDK_IS_FRAME_CLOCK (clock)' failed
page loaded http://127.0.0.1:1415/ 265 ms
page loaded http://127.0.0.1:1415/posts/long/ 321 ms
^T^[[menu drawn 1.7 ms
menu drawn 1.2 ms
menu drawn 1.3 ms
menu drawn 1.3 ms
menu drawn 52.5 ms
menu drawn 1.1 ms
menu drawn 0.9 ms
menu drawn 1.6 ms
menu drawn 1.2 ms
menu drawn 53.0 ms
menu drawn 1.5 ms
menu drawn 1.6 ms
menu drawn 1.1 ms
menu drawn 2.3 ms
menu drawn 2.7 ms
menu drawn 1.2 ms
menu drawn 1.1 ms
menu drawn 2.0 ms
menu drawn 1.5 ms
menu drawn 2.3 ms
menu drawn 1.3 ms
menu drawn 1.6 ms
menu drawn 1.3 ms
menu drawn 1.5 ms
menu drawn 2.1 ms
menu drawn 1.7 ms
menu drawn 1.9 ms
```


Ok i recreated the behavior, i restarted the app, when to `C17` saw the menu, and use the arrows to go down until i got to the text box where it says `in words: bigger, cenetered`

And i lost the keyboard strokes again!

## pre move revision of rune to current

do we have dark/light mode for every theme? it doesnt seem like we do. Paper and speia only have light and ink only has dark i didnt test more. i am just making sure this is by design. if a theme does not have a built in dark/light mode, depending on the `mode` grey out and skip the themes that dont have that mode ie if dark paper is not selectable


for theme menus make it so if you click down on the last item it goes back to the top and up on the top it goes to do the bottom. this behavior MAYBE for all menus, so dont make it too specific yet, just do it for theme menu first

C49 when i hit return, it instantly said ready (probably a test thing), and created the take, i was able to go back to the menu and `go back to quote`

also rewrite the `go back to <component>` for originals, and just say `revert to original` or something like that? lets discuss this.

Same with `Own` on drafted components.  its not clear what `own` means. maybe `custom`? i dunno, not `own`. again lets discuss

Insert part works great, the menu can be a bit more clear, i am not sure how tho, i like the vertial menu, but `writing 7` and then 7 options is ok, but i wonder if there is a better way? lets discuss. 

Also, so some components show prefilled template stuff like `lead` and `glossary` and some dont like `quote` and some others but as i was testing it crashed:


```sh 
A process crashed on this Omarchy machine and I want to know why.

What systemd-coredump recorded:
  process:  WebKitWebProcess
  PID:      3169970
  binary:   /usr/lib/webkit2gtk-4.1/WebKitWebProcess
  signal:   SIGABRT
  time:     Wed 2026-11-25 23:04:14 EST

Use the diagnose-crash skill: it covers how to investigate, what to report, and
when a crash is worth reporting upstream to Omarchy. If your harness has no skill
mechanism, read the skill files directly and follow them instead:

  /usr/share/omarchy/default/agents/skills/diagnose-crash/SKILL.md
```

and from the rust cli:

```sh
(rubric-app:3169868): Gdk-CRITICAL **: 22:38:25.077: _gdk_frame_clock_freeze: assertion 'GDK_IS_FRAME_CLOCK (clock)' failed
page loaded http://127.0.0.1:1415/ 254 ms
page loaded http://127.0.0.1:1415/posts/long/ 308 ms
menu drawn 3.1 ms: draft, server 1.8 ms
menu drawn 1.8 ms: draft, server 0.9 ms
menu drawn 1.3 ms: draft, server 0.9 ms
menu drawn 1.0 ms: draft, server 0.6 ms
menu drawn 1.1 ms: draft, server 0.7 ms
menu drawn 53.0 ms: draft, server 52.0 ms
menu drawn 1.5 ms: draft, server 0.7 ms
menu drawn 3.3 ms: part, server 2.0 ms
menu drawn 1.7 ms: part, server 1.2 ms
menu drawn 1.6 ms: part, server 1.2 ms
menu drawn 2.0 ms: part, server 1.5 ms
menu drawn 2.1 ms: part, server 1.2 ms
menu drawn 1.9 ms: part, server 1.2 ms
menu drawn 1.9 ms: part, server 1.0 ms
menu drawn 1.9 ms: part, server 1.2 ms
menu drawn 1.9 ms: part, server 1.4 ms
menu drawn 1.9 ms: part, server 1.1 ms
menu drawn 1.8 ms: part, server 1.2 ms
menu drawn 53.3 ms: words-menu, server 52.4 ms
GStreamer element autoaudiosink not found. Please install it

(WebKitWebProcess:3169970): GLib-GObject-CRITICAL **: 23:04:12.544: invalid (NULL) pointer instance

(WebKitWebProcess:3169970): GLib-GObject-CRITICAL **: 23:04:12.544: g_signal_connect_data: assertion 'G_TYPE_CHECK_INSTANCE (instance)' failed
```
```
```

So we got pretty far, but found another crash. most of this is ExCELLENT. 
