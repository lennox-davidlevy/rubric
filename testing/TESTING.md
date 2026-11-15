# Live test: around a draft, and changing a catalog part

Only the rows not yet run. The rest of this test ran on 2026-11-13 and is in [TESTING-jev-and-drafts.md](TESTING-jev-and-drafts.md); earlier tables are in [TESTING-fast-drafts.md](TESTING-fast-drafts.md), the step-by-step walk through drafting in [TESTING-new-parts.md](TESTING-new-parts.md), and the whole product's run in [TESTING-full.md](TESTING-full.md).

Write what you find in **Notes** at the bottom, by test number.

Last updated: 2026-11-14.

## Set up

1. Quit every Neovim, stop `bun run play`, start it again from the repo root. Keep its terminal in view: it prints each call to Jev.
2. Open http://localhost:1415/posts/walk/ and `nvim testing/pages/posts/walk.md`.

`<M-l>` is the accept key: once to ask at once, again to accept. D18 and section E make paid drafts with whichever drafter is set.

## D. Around a draft

D16 and D17 use the recipe card and carousel already kept in `testing/parts/`; D18 uses the kept stamps.

| # | Do this | Expect |
|---|---|---|
| D15 | `::: steps` on a new line, `:::` under it; cursor on the `::: steps` line, then on the empty line inside | The starter shows dimmed on the opening line only; inside the block, where you type, it is gone. `<M-l>` inside still fills it in. |
| D16 | A kept part that splits by `###` (the recipe card), placed inside a slide of the kept carousel or a step of `::: steps` | The inner part draws whole inside its slide or step; its own `###` headings don't become slides or steps. |
| D17 | Two recipe cards placed straight in the kept carousel, or two parts straight in `::: steps`, with no `###` around them | Each part is a slide or step of its own. `steps` draws no empty heading; the kept carousel was drafted before this and draws an empty one per slide until it is rerolled. A `::: fold` holding a part straight in it stays one closed section. |
| D18 | `::: new: a row of postage stamps with perforated edges, each holding a word`, **Draft**, then `<M-l>`, **Cancel** | The line is your words again, with no ghost text and nothing drawn: the page shows the words as text. Change a word: the kept part is offered again. `::: new:` with the same words still offers the cancelled takes back. |

## E. Changing a catalog part for the site

Use the two `::: quote` blocks on the walk page, one `size=large`. Set up as on 2026-11-13: `<M-l>` on a quote line with writing in it, **Change…**, `a torn paper edge`, Enter, and wait for the take (paid).

| # | Do this | Expect |
|---|---|---|
| E3 | On the `::: quote` line, add ` : larger, and centered`, pause (not `map`: it can't be changed, E10) | Ghost text with settings from Jev, as before. `<M-l>`, **Change…**: the words are filled in. Enter starts the change and the words leave the line. |
| E4 | On a ready take: `<M-l>`, **Keep this take** | Kept at once, with no "This site / Every theme" question. `testing/parts/quote/` has three files. Every page's quotes draw it. `git status catalogs/` shows nothing changed. |
| E5 | Cursor on the kept part's line; then `<M-l>` | A hint at the line's end: "reroll quote, or back to the catalog's". The menu: **Reroll…**, **Back to the catalog's quote**, and no "Add to every theme". |
| E6 | `::: quote size=large` and `align=center` after keeping | Both settings still work: a change can add settings, never drop one. |
| E7 | **Reroll…**, **Make changes…**, Notes `drop the size setting`, **Reroll** | The take keeps `size`: the checks send back a take that drops it. If the draft fails instead, its message names `size`. |
| E8 | **Back to the catalog's quote** | `parts/quote/` moves to `.rubric/logs/removed/`; the quotes draw as the catalog's again. |
| E9 | In `rubric.md`, `::: theme blowfish`; change `callout` on a page and keep it | The page draws the site's callout, not Blowfish's own. Set the theme back after. |
| E10 | `<M-l>` on a `::: tabs`, `::: map` or `::: video` line with writing in it | No menu: a part with a script, or one whose drawing fetches from another site, can't be changed. |
| E11 | In `blowfish`, **Change…** on a `callout`, then `<M-p>` to take 1 | Take 1 is Blowfish's callout as it was on screen, not Paper's. |
| E12 | On a `::: quote` line, add ` : with a torn paper edge`, pause | Ghost text `⇒ change quote`: no setting matches. `<M-l>` leaves the line and opens the quote's menu; **Change…** has the words filled in. Nothing is drafted until then. |
| E13 | The same on a `::: map` line: ` : with a torn paper edge`, pause | Ghost text `⇒ nothing map can set`. `<M-l>` leaves the line as it was. |

## Notes



