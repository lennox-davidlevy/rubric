# Live test: before the app

What changed in the plan's "Before the app" list (docs/plan.md, under step 8), item by item. Earlier tables: [TESTING-command.md](TESTING-command.md), [TESTING-variants.md](TESTING-variants.md), [TESTING-jev-and-drafts.md](TESTING-jev-and-drafts.md), [TESTING-full.md](TESTING-full.md).

Write what you find in **Notes** at the bottom, by test number.

Last updated: 2026-11-16 (section A, the app slice).

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

Step 9's first slice: the post on the left in Rune, the page on the right in a web view, one pick taken with Tab. The plan is [docs/app-slice.md](../docs/app-slice.md); the findings and numbers are in [docs/app-slice-findings.md](../docs/app-slice-findings.md). Start it from the repo with `cargo run --release --manifest-path app/Cargo.toml -- sites/app-slice/pages/posts/long.md`; the site's process starts with it, with the stub (no Jev calls). Do not open `sites/app-slice` in Neovim: its server is the live one, and a stub process and a live one refuse each other.

**Not on the NVIDIA display for now.** The app's window crashed Xorg twice there on 2026-11-16, once as it closed and once as it opened (the findings, "How the session ran the window"). Run section A only once the crash is explained, or on the Mac.

| # | Do this | Expect |
|---|---|---|
| A1 | Start the app | Window with the post on the left, ready to type at once; the page on the right within a second. |
| A2 | Type a paragraph fast | Letters appear with no lag; the page gains the paragraph in place. |
| A3 | Hold a key down for five seconds mid-post | No stutter in the editor; the page catches up when the key is released. |
| A4 | Move the caret from top to bottom | The page scrolls to follow. |
| A5 | Drag the divider left, right, and to each edge | Both panes resize together; each edge snaps; dragging back restores both, and typing still goes to the writing. |
| A6 | Resize the window | The page stays in its pane. |
| A7 | Click a link in the page, then click in the editor and type | The page goes there; typing goes to the editor. |
| A8 | On a new empty line type `::: a quote` | A closing `:::` appears below; a dimmed pick after the caret. |
| A9 | Press Tab | The line becomes the part; the page draws it. |
| A10 | After A9, undo once (Ctrl+Z) | The words come back. |
| A11 | Press Tab on a plain line | Nothing changes; the caret stays in the editor. |
| A12 | Ctrl+S, then `cat` the file | It holds what was typed. |
| A13 | Quit, then `pgrep -fa 'rubric-app\|cli.ts lsp\|WebKitWebProcess'` | Nothing. (`rubric stop sites/app-slice` ends the site's process and Hugo, which otherwise stay a minute.) |
| A14 | Type plain prose in Neovim on a post in `testing/`, and the same in the app | The app feels at least as immediate. This is the row that decides. |

After A12, `git checkout sites/app-slice/pages/posts/long.md` restores the post (once the slice is committed).

## Notes

