# Live test: fast drafts

What is new on branch `fast-drafts`, as tables. The full walk through drafting a part, step by step, is in [TESTING-new-parts.md](TESTING-new-parts.md); the whole product's run is in [TESTING-full.md](TESTING-full.md).

Write what you find in **Notes** at the bottom, by test number.

Last updated: 2026-11-12.

## Set up

1. Quit every Neovim, stop `bun run play`, start it again from the repo root.
2. Open http://localhost:1415/posts/walk/ and `nvim testing/pages/posts/walk.md`.
3. `:Rubric model`, choose **opus**, then **low**.

`<M-l>` is the accept key. "Drafter" below is what `:Rubric model` is set to unless the row says otherwise. Every draft is a paid call on your plan.

## A. Start here: the new examples

| # | Type this, then `<M-l>` and Draft | Drafter | Expect |
|---|---|---|---|
| A1 | `::: new: a row of polaroid photos pinned at slight angles, each with a caption` | opus, low | Ready in about 20 s. Photos drawn as real cards that stand off the page. |
| A2 | `::: new: a sticky note stuck to the page` | opus, low | A sticky note, not the paperclip note with small changes. |
| A3 | `::: new: a window with snow falling behind a heading` | opus, low | Its own window, not the rain window with white drops. |
| A4 | Three requests of your own, unlike the examples | opus, low | No paperclips, window frames or waves unless asked for. |
| A5 | Any one of the above again | sonnet, low | 12 to 15 s. Note whether you would keep it. |
| A6 | A draft that falls short: Reroll…, Reroll with changes…, Drafter | opus, medium | 40 to 80 s. Note whether it was worth the wait. |

## B. Fast drafts

| # | Do this | Setting | Expect |
|---|---|---|---|
| B1 | Draft `::: a heading with trees surrounding it` | sonnet, low | Ready in 11 to 15 s. `:Rubric log` shows three files written, 1 turn, no "read brief.md". |
| B2 | Cancel it, `:Rubric drafting`, draft the same words | tools mode | Much slower. The last two lines of `testing/.rubric/logs/drafts.jsonl` have `"mode"` fast and tools. Switch back after. |
| B3 | `:Rubric model`, opus, **its default effort**, draft anything | fast mode | The record says `"effort":"low"`. |
| B4 | Reroll a ready draft with a change, such as "taller trees" | any | 10 to 20 s. Only the files it changed are written. |
| B5 | Reroll with no change | any | Another take, drawn differently. |
| B6 | Reroll a part you kept, on its `::: name` line | any | Fast, and the part keeps its name. |
| B7 | `::: new: a quote from someone`, draft | any | Drafts at once. The line's note ends by naming `quote` as a part the catalog has. |
| B8 | Start a draft, Stop, then `<M-l>` and Draft straight away | any | The new draft starts once the stopped one is gone. |
| B9 | A draft whose log says "the checks refused it" | any | "asking for a fix, once", then ready, with `"runs":2` in the record. |
| B10 | Draft once with an OpenCode model (Draft with…) | OpenCode | One step, files from its reply, ready. If "the reply had no files in it", paste `harness.log` in Notes. |

## C. Menus

| # | Do this | Expect |
|---|---|---|
| C1 | `::: new: a quote with a big mark`, some writing inside the block, `<M-l>` | First entry is "Similar: quote" or "Similar parts (N)". The menu opens within 0.7 s. |
| C2 | Choose it and move through the list | The browser draws each part where the line is, with your writing in it. Yours are first, marked "yours". |
| C3 | Enter on one; then try again and Esc | Enter puts the part on the line. Esc restores the page and returns to the menu. |
| C4 | `::: new: a row of candles for each thing I learned`, with `candle-row` kept | `candle-row` is at the top of the list. |
| C5 | `::: new: a tide chart of items` | No "Similar" entry. |
| C11 | `::: new: a window with snow falling behind a heading`, with `rain-window` kept. Restart the editor's server first. | "Similar: rain-window" is offered, marked "yours". It was missing before: similar parts were hidden whenever nothing fit. Note lines where the similar part is nowhere near. |
| C6 | On a ready draft: Reroll…, Reroll with changes… | Only "Notes: …", "Drafter: …" and "Back". Nothing starts. |
| C7 | Set notes and a drafter, then Back | The first entry reads like "Reroll with opus: “bigger”" and starts it. |
| C8 | On a new `new:` line: Draft with… | The drafter list opens; choosing one returns to the menu with "Draft (opus…)". |
| C9 | Look at a ready draft's line | `◆ name drafted · takes size, pace · <M-l> keep, reroll, cancel`. Hovering the note lists the values. |
| C10 | Read every menu, note and notice as you go | None reads like a sentence spoken to you. Note any that do, or that became unclear. |

## D. Parts fixed

| # | On the walk page, set | Expect |
|---|---|---|
| D1 | Any part with headings inside, such as `lighthouse-heading` | No `#` mark on headings inside the part; the page's own headings keep theirs. |
| D2 | `spooky-frame size=large`, then `small`, `medium` | About 32rem wide at large; the others visibly smaller. |
| D3 | `bookshelf size=small`, `medium`, `large`, with one long title | The same shelf at three scales. Books keep their shape; a title wraps the same way. |
| D4 | `clipped-note shadow=deep`, then `border=outlined`, `corners=round` | Each is drawn on the note itself, tilted with it. Nothing around the block. |
| D5 | `shadow=deep` on `letter`, `bookshelf`, `clothesline` | The shadow sits on the sheet, the case and each note. |
| D6 | `clothesline size=small`, then `large` | Notes and type shrink and grow together. Note if small type is too small. |
| D7 | `horse-frame` at phone width | The page does not scroll sideways. |

## E. The record

Each check is one command after the action.

| # | After | Run | Expect |
|---|---|---|---|
| E1 | Keeping or cancelling any first draft | `tail -n 1 testing/.rubric/logs/drafts.jsonl \| jq .traits` | Six numbers from 0 to 1 that match the request, such as `moves` near 1 for something that flies. |
| E2 | A reroll with notes, then keep | `tail -n 3 testing/.rubric/logs/drafts.jsonl \| jq '{change, traits}'` | That take has your notes under `change` and the same `traits` as its first draft. |
| E3 | A part kept for every theme | `grep -B3 "drafted: true" catalogs/universal/catalog.yaml` | The new part's entry has `drafted: true`, and it is listed as "yours" in C2. |

## Notes


