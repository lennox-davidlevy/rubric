# Live test: variants

Run on 2026-11-15; what it found was fixed and is on `main` (PR #7). A change to a part is a variant beside it, not a replacement of it. Earlier tables are in [TESTING-jev-and-drafts.md](TESTING-jev-and-drafts.md) (Jev's picks, drafts by both tools, around a draft), [TESTING-fast-drafts.md](TESTING-fast-drafts.md), [TESTING-new-parts.md](TESTING-new-parts.md) and [TESTING-full.md](TESTING-full.md).

## Set up

1. Quit every Neovim, stop `bun run play`, start it again from the repo root on branch `variants`.
2. Open http://localhost:1415/posts/walk/ and `nvim testing/pages/posts/walk.md`. It has two `::: quote` blocks: `size=large align=center`, and `size=large` below it.

`<M-l>` opens a part's menu in **normal mode** only (Esc first); in insert mode it accepts the ghost text. E2, E9, E10, E11, E12 and E15 make paid drafts with whichever drafter is set; ask Claude before running them if unsure.

## E. Variants

`<name>` is the name the drafter gives the variant, such as `torn-edge`.

| # | Do this | Expect |
|---|---|---|
| E1 | Normal mode, `<M-l>` on the `::: quote size=large` line | A menu with **Change…**, and no Reroll, Keep or Remove. |
| E2 | **Change…**, `a torn paper edge`, Enter | The line reads `::: quote size=large : a torn paper edge` while it drafts, with no ghost text. Ready in about 20 s: only this quote draws the take; the other quote stays as it was. `<M-p>` shows the quote as it was; `<M-n>` goes back. |
| E3 | `<M-l>`, **Keep this take** | The line becomes `::: quote size=large variant=<name>`. `testing/parts/quote--<name>/` has three files. The other quote is unchanged. `git status catalogs/` shows nothing changed. |
| E4 | On the other quote's line, add ` : with a torn paper edge`, pause | Ghost text `⇒ variant=<name>`, Jev reading the variant's description. If it says `⇒ change quote` instead, note the words and the variant's description from its part.yaml. |
| E5 | `::: a quote with a torn paper edge` on a new line, pause | Note whether the ghost text is `quote variant=<name>`. |
| E6 | Cursor on the variant's line in normal mode; then `<M-l>` | A hint at the line's end: "reroll or change <name>, or back to quote". The menu: **Reroll…**, **Change…**, **Every quote as <name>**, **Back to the catalog's quote**, **Remove quote--<name> from this site…**. |
| E7 | **Every quote as <name>**; then look at another page with a quote; then the menu again, **Every quote plain** | Every `::: quote` with no `variant=`, on every page, draws the variant; then the catalog's again. |
| E8 | **Back to the catalog's quote** | `variant=<name>` leaves the line and the quote draws as the catalog's. `testing/parts/quote--<name>/` is still there. Put `variant=<name>` back. |
| E9 | **Reroll…**, **Make changes…**, Notes `darker`, **Reroll** | A take that keeps the name: every line with `variant=<name>` draws it. **Keep this take** writes it over `parts/quote--<name>/`; the line stays. |
| E10 | **Reroll…**, **Make changes…**, Notes `drop the size setting`, **Reroll** | The take keeps `size`: the checks send back a take that drops it. If the draft fails instead, its message names `size`. |
| E11 | On the variant's line, **Change…**, `with ivy growing over it`, Enter, then keep | A second variant, `quote--<other>`, drawn from the first: take 1 is the first variant. Both are offered by Jev from their words (E4). |
| E12 | `<M-l>` on a kept part's line, such as `::: stamps` | **Reroll…** and **Change…**. **Change…** `in gold` makes `stamps--<name>`; **Reroll…** still redrafts `stamps` itself. |
| E13 | On a new `::: quote : with a gold border` line, `<M-l>` on the `⇒ change quote` ghost text, **Change…** (filled in), Enter; then `<M-l>`, **Back to the catalog's quote** | The line goes back to `::: quote`; nothing new in `testing/parts/`. |
| E14 | **Remove quote--<name> from this site…** on a variant's line | Its files move to `.rubric/logs/removed/`; lines that still ask for it get a note, and the quote draws as text until they change. |
| E15 | In `rubric.md`, `::: theme blowfish`; on a `::: callout` with writing, **Change…** `with a torn edge` | Take 1 (`<M-p>`) is Blowfish's callout. Kept: the variant draws in Blowfish, and every other callout stays Blowfish's. Set the theme back after. |
| E16 | In `testing/pages/parts.md`, `<M-l>` on a `::: tabs`, `::: map` or `::: video` line with writing in it | No menu: a part with a script, or one whose drawing fetches from another site, can't have variants. |
| E17 | On the `::: map zoom=street` line in `parts.md`, add ` : with a torn paper edge`, pause | Ghost text `⇒ nothing map can set`. `<M-l>` leaves the line as it was. |

## F. Fixes from the first run (2026-11-15)

Restart `bun run play` and Neovim first.

| # | Do this | Expect |
|---|---|---|
| F1 | On a variant's line, such as `::: stamps variant=gold`, **Remove stamps--gold from this site…** | The line becomes `::: stamps` and draws the part. Other lines that still say `variant=gold` get a note. |
| F2 | `<M-l>` in normal mode on the `::: tabs` or `::: map zoom=street` line in `parts.md` | Dim text at the line's end: "tabs has no variants". No menu; the cursor stays put. Moving the cursor clears it. |
| F3 | On the `::: map zoom=street` line, add ` : with a torn paper edge`, pause | Ghost text `⇒ nothing map can set`. |
| F4 | In `rubric.md`, change the theme name on `::: theme …` by typing over it (`ciw`, or backspace, then `bl`) | A completion menu with `blowfish` and `blog-awesome`. If none shows, note the exact keys. |

## Notes



