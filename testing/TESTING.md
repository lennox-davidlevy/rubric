# Live test: the `rubric` command

One process per site now holds the language server, Hugo and the cursor relay. Opening a page starts it, and it stops a minute after the last Neovim closes. Nothing is started by hand, and `bun run play` is gone. Branch `rubric-command`. Earlier tables: [TESTING-variants.md](TESTING-variants.md), [TESTING-jev-and-drafts.md](TESTING-jev-and-drafts.md), [TESTING-full.md](TESTING-full.md).

Write what you find in **Notes** at the bottom, by test number.

Last updated: 2026-11-15.

## Set up

1. Quit every Neovim. Stop the old `bun run play` with Ctrl-C. Check out `rubric-command`.
2. `which rubric` prints `~/.bun/bin/rubric`.

R5, R6 and R12 wait a minute or more. Only R13 makes a paid draft.

## R. The command

| # | Do this | Expect |
|---|---|---|
| R1 | `nvim testing/pages/posts/walk.md` | Within a second or two, a notice `rubric: http://127.0.0.1:1415/`. Diagnostics and ghost text work as before. |
| R2 | `:Rubric open` | The browser opens the page. Typing changes it and moving the cursor scrolls it, as before. |
| R3 | In a second terminal, `nvim testing/pages/parts.md` | The same address in the notice. `pgrep -fa 'hugo server'` shows one Hugo for `testing/`. |
| R4 | In a third terminal, from `testing/`: `rubric calls`. Type a new words line in either Neovim and pause. | The call prints there, as `bun run play` printed it. Ctrl-C prints the sum. |
| R5 | Quit both Neovims and wait a minute. Then `pgrep -fa cli.ts` and `pgrep -fa 'hugo server'`. | Nothing for `testing/`, and the page no longer loads. |
| R6 | From `testing/`: `rubric` | It prints the address and stays in front. Open and quit Neovim on a page: the page stays up. Ctrl-C stops it, Hugo too. |
| R7 | With a Neovim open on `walk.md`, change `pages/posts/reservoir.md` in another editor (or `echo 'More.' >> testing/pages/posts/reservoir.md`) and save | http://127.0.0.1:1415/posts/reservoir/ shows the change. Put the file back with `git checkout testing/pages/posts/reservoir.md`. |
| R8 | `:Rubric harness` in one Neovim, choose a drafter; open a `new:` line's menu in a second Neovim on the site | The second names the drafter just chosen: the drafter is the site's. |
| R9 | `cd /tmp && rubric new my-garden`, then `cd my-garden && nvim rubric.md` | It prints the folder. The folder holds `rubric.md`, `hugo.toml` (a title only), `pages/` and `.gitignore`. A notice gives the address, likely 1417 with `testing/` still open. |
| R10 | In `my-garden`'s `rubric.md`: `::: theme`, `<M-l>`, choose one. Then `::: header` with links inside, and `::: a footer with my name and the year`, pause, `<M-l>`. | The theme list, the header and the footer work as in `testing/`. |
| R11 | `nvim pages/posts/first.md`: a sentence, `::: a quote from my grandmother`, then `::: the three things I learned, in order`, then ` : larger, and centered` on the quote | A quote, steps with their starter, then the quote's settings. |
| R12 | Quit Neovim, then `rubric build` in `my-garden` | It prints `/tmp/my-garden/public`. `public/posts/first/index.html` holds the quote and the steps, drawn in the theme. No `rubric-frame` folder in `public/`. |
| R13 | Optional, paid: a `::: new: …` line in `my-garden`, **Draft**, then **Keep**, **This site** | It drafts as in `testing/`. The part is in `/tmp/my-garden/parts/`. |
| R14 | `rubric stop` in `testing/` while a Neovim is open on it | `stopped`. Neovim's Rubric client goes, and quitting and reopening Neovim starts the process again. |

## S. Schematic, a theme after Making Software

New theme `schematic`, two new parts for every theme (catalog version 11): `glossary` in the writing, `reading-progress` in rubric.md. Use `my-garden` from R9 (before the cleanup below).

| # | Do this | Expect |
|---|---|---|
| S1 | In `my-garden`'s `rubric.md`: `::: theme`, `<M-l>`, find **schematic** in the list | Its picture: a white sheet on a pale page, mono capitals for the name and the trail. Choose it. |
| S2 | Add `::: sidebar` with two `### 1. A chapter` headings and links under each, `::: breadcrumbs`, `::: post-meta shows=everything` and `::: reading-progress style=ruler` | The sidebar's headings in mono capitals, the sheet beside it on the left, the details above the title as `DATE \| N WORDS \| AUTHOR`, and ticks down the right edge with the share read in blue as you scroll. |
| S3 | `::: a bar showing how far down the page I've read` in `rubric.md`, pause | Offers `reading-progress`. |
| S4 | In `pages/posts/first.md`: a paragraph using the words "capacitor" and "amplitude", then `## Glossary` and `::: a glossary of the terms I use`, pause, `<M-l>` | Offers `glossary` and writes a starter list. Replace it with `- **Capacitor**: …` and `- **Amplitude**: …`. |
| S5 | On the page, point at "capacitor" in the paragraph | Dotted underline with a small number. Its meaning shows in the right margin, outside the sheet, level with the line. Clicking it jumps to the glossary, which flashes; the term there links back. |
| S6 | Add `---` between two paragraphs, a `::: figure width=wide`, a `::: gallery columns=two` and a `::: sidenote` | The break is `╌╌╌╌`, captions in mono capitals, the sidenote outside the sheet on a wide screen. The post ends with `╌╌ END ╌╌`. |
| S7 | Narrow the browser to a phone (dev tools, 390px) | No sheet, the gallery swipes one picture at a time, the sidenote sits in the writing, no ruler. Nothing scrolls sideways. |
| S8 | Switch the system to dark | Dark gray sheet on near-black, light ink, a lighter blue. |
| S9 | `rubric build` in `my-garden`, open `public/posts/first/index.html` | Drawn in schematic, not Paper (build used to drop the theme line). |

Afterwards: `rm -rf /tmp/my-garden`.

## Notes



