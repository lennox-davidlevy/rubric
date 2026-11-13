# Live test: picks by Jev, and drafts by both tools

Three passes as tables: what Jev does with words, new parts drafted by Claude Code, and the same requests drafted by OpenCode. Then the flow around a draft, once, and changing a catalog part for the site (section E, branch `customize`).

Earlier tables are in [TESTING-fast-drafts.md](TESTING-fast-drafts.md) (parts fixed, menus), the step-by-step walk through drafting in [TESTING-new-parts.md](TESTING-new-parts.md), and the whole product's run in [TESTING-full.md](TESTING-full.md).

Write what you find in **Notes** at the bottom, by test number.

Last updated: 2026-11-13.

## Set up

1. Quit every Neovim, stop `bun run play`, start it again from the repo root. Keep its terminal in view: it prints each call to Jev.
2. Open http://localhost:1415/posts/walk/ and `nvim testing/pages/posts/walk.md`.

`<M-l>` is the accept key: once to ask at once, again to accept. Sections B to D make paid drafts on your plans.

## A. Jev: parts by words

No drafts here; each call costs a fraction of a cent. Type the line, pause, then `<M-l>`.

| # | Type this | Expect |
|---|---|---|
| A1 | `::: a big opening for the top of the page` | The closing `:::` appears at the first space. Ghost text `-> hero size=tall` with its starter; the page shows the hero faded. `<M-l>` puts `hero size=tall` on the line, writes the starter, and the hero turns solid. |
| A2 | `::: a tip for the reader`, with a sentence written inside the block before accepting | Accepting changes only the `:::` line. The sentence stays. |
| A3 | `::: a quote from my grandmother` | `-> quote`. In the terminal: one call, about 150 ms, with each part's probability. |
| A4 | `::: the three things I learned, in order` | `-> steps`. `<M-l>` on the empty block writes its starter in. |
| A5 | `::: something on the side` | If Jev is unsure, a dim "1 of 2" hint. `<M-n>` shows the other pick in the ghost text and on the page; `<M-p>` goes back; `<M-l>` keeps the one showing. Note whether you got the hint. |
| A6 | `::: the menu as a pdf` | Stays as text on the page; the note says not sure, naming two parts; `<M-n>` draws each. |
| A7 | `::: a small quote in smaller text` | `quote text=smaller`. |
| A8 | `::: a big centered quote from the interview` | `quote size=large align=center`. |
| A9 | On the A3 line, add ` : larger, and centered`, pause, `<M-l>` | Ghost text with the settings, such as `size=large align=center`. Accepting writes them on the line and drops the words. One "second pass" call in the terminal; the part is not asked again. |
| A10 | Then ` : with a soft shadow and round corners` | `shadow=soft corners=round` added. |
| A11 | `::: quote size=large`, typed in plain form | The quote draws at once. No call in the terminal. |
| A12 | Delete the A3 block and type its words again | Ghost text at once, from the cache. No call in the terminal. |
| A13 | `K` on a line of words, then on an accepted line; `<leader>e` on a line with a note | The pick, its fit and how each part scored; the part's description and settings; the note. |
| A14 | `::: a paper boat that drifts across the page` | Ghost text offers a new part. Leave it as words for now, or accept to make it a `new:` line for section B. |
| A15 | In `testing/rubric.md`: `::: a top navigation bar`, then `::: a footer with my name and the year` | `header`, then `footer`, on every page. |
| A16 | In `rubric.md`, `<M-l>` on the `::: theme` line; move through the list; Enter on one | A picture of each theme; the page takes on the one under the cursor. Enter keeps it, Esc puts the old one back. |
| A17 | `::: theme something warm and bookish`, `<M-l>` | The same list, in an order that fits the words. |
| A18 | Pause on any new line and watch the clock | Ghost text within about a second of stopping. Note any line that felt slow. |

## B. Drafts by Claude Code

Set up: `:Rubric harness`, **Claude Code**, **opus**, **low**, **No tools**. The notice ends "no tools".

Type each line, `<M-l>`, **Draft**. Cancel or keep as you like; keeping B1 and B4 helps section D.

| # | Request | Drafter | Expect |
|---|---|---|---|
| B1 | `::: new: a row of postage stamps with perforated edges, each holding a word` | opus, low | Ready in about 20 s. Stamps that read as stamps, one per item, with the edge drawn. |
| B2 | `::: new: a heading with a candle beside it whose flame flickers` | opus, low | About 20 s. The flame moves; with motion reduced in the system settings it holds still. |
| B3 | `::: new: a ring that fills to show a percentage, with the number in the middle` | opus, low | The ring's fill follows the number written in the block. Change the number: the ring follows. |
| B4 | `::: new: a recipe card with the ingredients on one side and the steps on the other` | opus, low | A card that stands off the page; two columns that stack at phone width. |
| B5 | `::: new: a heading that feels like a quiet library` | opus, low | Its own idea of the feeling, not a plain heading. Note what it drew. |
| B6 | `::: new: a picture frame with ivy growing around it, and a caption`, then put `![A sample](/images/sample.jpg)` and a caption inside | opus, low | The picture sits in the frame; the caption is under it. |
| B7 | Any two of the above again, on new lines | sonnet, low (**Draft with…**) | 12 to 15 s. Note whether you would keep them. |
| B8 | A draft that fell short: **Reroll…**, **Make changes…**, **Drafter**, opus, medium, then **Reroll** | opus, medium | 40 to 80 s. Note whether it was worth the wait. |
| B9 | Throughout | | None borrows a paperclip, a rain window or waves from the brief's examples. Nothing scrolls sideways at phone width. |

## C. Drafts by OpenCode

Set up: `:Rubric harness`, **OpenCode**. The model list starts with `openai/gpt-6.1-terra-fast  (suggested)`: choose it. The effort list is none, low, medium, high, xhigh, max, with no "minimal": choose **low**, then **No tools**.

The same six requests, on new lines, so each can be set beside its Claude draft.

| # | Request | Drafter | Expect |
|---|---|---|---|
| C1 | The B1 line (postage stamps) | terra-fast, low | Ready in about 8 s. Plainer than Opus is expected; note where it falls short. |
| C2 | The B2 line (candle) | terra-fast, low | About 8 s. The flame moves. |
| C3 | The B3 line (ring) | terra-fast, low | The fill follows the number. |
| C4 | The B4 line (recipe card) | terra-fast, low | Two columns that stack at phone width. |
| C5 | The B5 line (quiet library) | terra-fast, low | Note what it drew, beside B5. |
| C6 | The B6 line (ivy frame), with the picture and caption inside | terra-fast, low | The picture in the frame, the caption under it. |
| C7 | The weakest of C1 to C6: **Reroll…**, **Make changes…**, **Drafter**, **Other…**, OpenCode, `openai/gpt-6.1-sol-fast`, low, then **Reroll** | sol-fast, low | About 20 s, and a better drawing. Note whether it was. |
| C8 | `:Rubric log` on any OpenCode draft | | One step, three files written from the reply, no "asking for a fix". If a draft says "the reply had no files in it", paste its `harness.log` in Notes. |
| C9 | `:Rubric harness`, OpenCode, a model with no efforts, such as an Ollama one | | The effort question is skipped. Go back to terra-fast after. |

## D. Around a draft

Once each, with whichever tool is set.

| # | Do this | Expect |
|---|---|---|
| D1 | With B1 kept: `::: new: a strip of stamps along the top`, `<M-l>` | "Similar: …" with the kept part, marked "yours", above Draft. Moving through the list draws each on the page; Enter puts it on the line with no draft. |
| D2 | On a ready draft: **Reroll…**, **Make changes…** | Only Notes, Drafter and Back. Nothing starts. |
| D3 | **Notes**, type `bigger, and fewer of them` | The list gains **Reroll** at the top, with the notes on the Notes line. It starts the reroll. |
| D4 | With two or more takes: `<M-l>`, **Takes (N)** | Oldest first, each with its time, drafter and notes; "(now)" on the one on screen, where the cursor starts. The page does not flash take 1 as the list opens. Moving draws each take; Enter stays, Esc goes back; both return to the menu. |
| D5 | `<M-n>` and `<M-p>` on the line | Cycle the takes, as before. |
| D6 | **Keep**, **This site** | The line becomes `::: name`. Three files in `testing/parts/<name>/`. |
| D7 | On a new line, the kept part's idea in other words, such as `::: those stamps again` | Jev offers the kept part in a fraction of a second. No draft. |
| D8 | `<M-l>` on the kept part's line, **Reroll…** | Another take that keeps the name; the Takes list's first entry reads "as kept". |
| D9 | Start a draft, `<M-l>`, **Stop**; then Draft again at once | The new draft starts once the stopped one is gone. |
| D10 | `:Rubric tooluse`, **Tools**; open any draft menu; then set **No tools** again | The menu reads "Draft (…, tools)" while tools are on, and loses it after. |
| D11 | With tools on and a part kept, a `new:` line for the same thing, Draft | It drafts. It never stops to say the site has the part. |
| D12 | After the session: `jq -r '[.started[11:16], .drafter.harness, .drafter.model, .mode, .seconds, .status, .outcome] \| @tsv' testing/.rubric/logs/drafts.jsonl \| tail -n 20` | One line a draft: the tool, model, mode, seconds and what became of it. Every one from B and C says `fast`. |
| D13 | With no drafter chosen (`:Rubric harness`, the setup's choice), open a `new:` line's menu | It reads "Draft (opus, low)": Opus at low effort is the built-in drafter. |
| D14 | `:Rubric model`, **sonnet**, **low**; then `:LspRestart`; open a `new:` line's menu | Still "Draft (sonnet, low)" after the restart. Set it back when done. |
| D15 | `::: steps` on a new line, `:::` under it; cursor on the `::: steps` line, then on the empty line inside | The starter shows dimmed on the opening line only; inside the block, where you type, it is gone. `<M-l>` inside still fills it in. |
| D16 | A kept part that splits by `###` (B4's recipe card), placed inside a slide of the kept carousel or a step of `::: steps` | The inner part draws whole inside its slide or step; its own `###` headings don't become slides or steps. |
| D17 | Two recipe cards placed straight in the kept carousel, or two parts straight in `::: steps`, with no `###` around them | Each part is a slide or step of its own. `steps` draws no empty heading; the carousel kept today was drafted before this and draws an empty one per slide until it is rerolled. A `::: fold` holding a part straight in it stays one closed section. |

## E. Changing a catalog part for the site

Branch `customize`. Each change is a paid draft with whichever drafter is set. Use a page with two `::: quote` blocks, one `size=large`.

| # | Do this | Expect |
|---|---|---|
| E1 | `<M-l>` in normal mode on a `::: quote` line with writing in it | A menu with **Change…** only. No "every theme", no remove. On an empty block the key fills the starter, as before. In insert mode the key never opens the menu. |
| E2 | **Change…**, type `a torn paper edge`, Enter | A draft starts at once with the default drafter; the line stays `::: quote`. Ready in about 20 s: both quotes on the page draw the take. `<M-p>` shows the catalog's quote as take 1; `<M-n>` goes back. |
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


