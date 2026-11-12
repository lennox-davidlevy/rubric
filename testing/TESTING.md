# Live test: new parts

Step 7. When nothing in the catalog fits your words, Rubric offers to draft a part for them. Claude Code or OpenCode writes it in the background, with the model you choose, using your theme's colors and type, and it shows on your page in the browser. You then keep it, reroll it or cancel it. If you keep it, you choose whether every theme gets it or only this site.

The theme list and parts with no closer passed; the whole run is in [TESTING-full.md](TESTING-full.md).

Write what you find in the **Notes** section at the bottom, numbered as below.

Last updated: 2026-11-11.

## 0. Set up

1. Quit **every** Neovim, so the new plugin and server load.
2. Stop `bun run play` and start it again from the repo root. `testing/hugo.toml` changed (Hugo now also reads `.rubric/hugo/`, where drafts go), and Hugo reads that only at start.
3. Open http://localhost:1415/posts/walk/ and `nvim testing/pages/posts/walk.md`.
4. One drafter is the default: out of the box, Claude Code with Sonnet at low effort. Any one draft or reroll can use another, chosen as you start it (sections 1 and 3); that never changes the default.
5. `:Rubric model` changes the default's model, then how hard it thinks: for Claude Code, low to max; for an OpenCode model, its variants (OpenAI: minimal to xhigh; Anthropic: high, max; Google: low, high). **its default effort** leaves it to the tool. A message says what drafts now.
6. `:Rubric harness` does the same, choosing the tool first, Claude Code or OpenCode, each with its version or "not installed". Quit Neovim and open it again, then `:Rubric model`. **Should happen:** your choice was kept, and the model in use is marked.

The default you choose here wins over `draft = {...}` in your setup, in every session. To go back to your setup's, use **Whatever my setup says** at the bottom of `:Rubric harness`.

Each draft is one headless run of that tool on your plan. A first real one took 44 seconds. Sections 1 to 5 make about four drafts.

## 1. Nothing fits, so you're offered a new part

On a new line near the end of `walk.md`, type `::: a ring of little moons orbiting the heading`, then pause.

**Should happen:**

- The line gets a note saying nothing in the catalog fits.
- The ghost text says `-> a new part, drafted for these words`.

Press `<M-l>`.

**Should happen:**

- The line becomes `::: new: a ring of little moons orbiting the heading`, and its `:::` closer stays.
- A menu asks how to draft it: **Draft it (sonnet, low)**, **Draft with a different setup…** or **Cancel**. **Cancel** puts your words back. Choose **Draft with a different setup…**: a short list with **Draft it** at the top and **Drafter: sonnet, low, the default…** under it. Choose **Drafter**: the default, any drafters you've used lately, and **Another tool or model…** (tool, then model, then effort). Pick one, then **Draft it with …** at the top. The default hasn't changed (`:Rubric model` shows it).
- The block now reads apart from the page: a bracket in the sign column from the `new:` line down to its `:::` closer, a faint wash of color behind the block, and `new:` in bold in that color. Blue while drafting.
- One spinner, on a line of its own under the `new:` line, with a running time: `drafting · 0:12`. Nothing spins in the sign column. The line wraps to the window, so none of it is cut off; make the window narrow to check.

If Jev picks a part for these words instead, try other words. Anything nothing fits will do.

Optionally, while it drafts, run `:Rubric log` with the cursor on the line (or `<M-l>`, then **Show the log**). **Should happen:** a window opens below with the draft's log, with a line for each step and the time since it started, and your cursor stays in the page. `:q` closes it.

## 2. The draft shows up

Keep writing elsewhere in the page while it works.

**Should happen:**

- When it's done, a message names the part.
- The browser shows it where the line is, in your current theme (Terminal with Gruvbox Dark).
- The spinner becomes a diamond, the line under it says `<name> drafted · <M-l> keep, reroll, cancel`, and the bracket and wash turn green.

Look at it in dark mode too, with the theme switch in the header.

## 3. Reroll, with a change

With the cursor on the line, press `<M-l>` and choose **Reroll…**. **Should happen:** it asks **Just reroll** or **Change something first…**. Choose **Change something first…**: a short list with **Reroll** at the top, **Notes: none…** and **Drafter: sonnet, low, the default…**. Choose **Notes** and type something like `smaller, and only three moons`. Optionally choose **Drafter** and pick Opus for this one. Then **Reroll …** at the top.

**Should happen:**

- The old draft stays in the browser while the new one is made, and the line says so beside the spinner.
- When it's done, the new one is drawn, and keeps what you didn't ask to change. The line under says `take 2 of 2 · <M-p> <M-n> other takes`.

**Reroll…**, then **Just reroll**, gives a different take on the same words with the default; do one, for three takes.

**Every take is kept.** With the cursor on the line, in normal or insert mode, press `<M-p>` and `<M-n>`. **Should happen:** the browser draws each take in turn, and the line says which (`take 1 of 3`), going round at either end. `<M-l>` also offers **Next take**. A reroll with a change starts from the take on screen.

Reroll once more, and while it's drafting press `<M-l>` and choose **Stop, and go back to <name>**. **Should happen:** the spinner goes, the diamond comes back, and the draft you had is still drawn and can still be kept.

## 4. Keep it, just for this site

Move to the take you like best, then press `<M-l>`, choose **Keep**, then **No, just this site**. The take on screen is the one kept; the others go to the record (section 8).

**Should happen:**

- The line becomes `::: <name>`, a plain part like any other, with no note.
- For a few seconds, a check under it says it's kept and lists the settings the part takes, such as `pace=slow|fast`. If it takes none, it says only that it's kept.
- Type a space after the name. **Should happen:** completion offers its settings, then their values, as for any catalog part. A value it doesn't have gets a note, and hovering on the name describes the part.
- The browser still draws it.
- If the block is empty, what the browser draws faded inside the part (its starter) now shows in Neovim too: dimmed lines inside the block, just above `:::`, the first ending in `<M-l> fills it in`. With the cursor on an empty line inside the block or on its `:::`, press `<M-l>`. **Should happen:** the starter is written in for real, with your cursor on its first line, and the dimmed lines go. Typing anything in the block yourself makes them go too. On the part's own line (say at the end of its name), `<M-l>` opens the part's menu (section 10), with **Fill in the starter** first.
- `git status` shows a new folder, `testing/parts/<name>/`, holding `part.yaml`, `part.html` and `part.css`. Read `part.css`: it should use only `var(--…)` for colors and fonts, never a color written out.
- Quit Neovim and open the page again. The part is still there, and still drawn.

Jev now chooses from a different list, so lines you haven't accepted yet are asked again as you reach them. Until then, they show as words in the browser, as after a catalog version bump.

Then try it by words. On a new line, describe the part in other words, such as `::: moons around a title`. **Should happen:** Jev may pick your new part, since it's in the list Jev picks from now, for this site only.

## 5. Typing `new:` yourself, and cancelling

On a new line, type `::: new: a little weather forecast box` and leave insert mode.

**Should happen:** the note says `<M-l>` drafts one, and nothing is drafted until you press it.

Press `<M-l>`, then **Draft it**. While it's drafting, the line under it says `<M-l>` stops or cancels it. Press `<M-l>` and choose **Stop drafting**. **Should happen:** the spinner goes and the line stays `::: new: a little weather forecast box`, with `+` on the line under it and a gray bracket, so `<M-l>` starts it again.

Press `<M-l>` and **Draft it** to start it again. While it's drafting, press `<M-l>` again and choose **Cancel the draft**.

**Should happen:** the line goes back to `::: a little weather forecast box`, and nothing is drawn for it.

**Cancelled takes come back.** Make one take of `::: new: a little sun and cloud`, let it finish, then `<M-l>` and **Cancel**. Type `::: new: a little sun and cloud` again on a new line and leave insert mode. **Should happen:** the line under it says `<M-l>` brings back 1 earlier take. `<M-l>` offers **Bring back 1 earlier take** or **Draft a new one**. Bringing it back draws it at once, with nothing drafted.

## 6. A part the catalog already has

Type `::: new: a pull quote from a book I read`, then `<M-l>`.

**Should happen:** after a moment, a message says the catalog already has `quote`. `<M-l>` then offers **Use quote**, **Draft one anyway** or **Cancel**. **Use quote** turns the line into `::: quote`.

## 7. For every theme (optional: this changes the catalog)

Draft one more, and choose **Keep**, then **Yes, every theme**.

**Should happen:**

- A message says it's in the catalog now, as version 10.
- `git diff catalogs/universal/catalog.yaml` shows the version bumped and the new part at the end.
- The new part's drawing and CSS are in `catalogs/universal/layouts/` and `assets/css/parts/`.
- `hugo server -s catalogs/universal/page` shows it on every theme's catalog page.

To undo it: `git checkout catalogs/universal` and `git clean -n catalogs/universal` (check the list, then `-f`).

A part you kept for the site in section 4 can go global from its line: `<M-l>`, then **Make it available to every theme** (section 10). `bun scripts/part.ts global testing <name>` still does the same.

## 8. Starters for every part

Starters aren't only for drafts. On a new line, type `::: steps`, then `:::` on the line below it, and leave insert mode.

**Should happen:** the two `###` steps show dimmed inside the block, as the browser shows them faded. `<M-l>` on the `:::` fills them in. `::: cards`, `::: hero` and `::: timeline` work the same way.

## 9. The record of every draft

After the sections above, look in `testing/.rubric/logs/`.

**Should happen:**

- `drafts.jsonl` has a line for every draft you made: the words, the tool and model, how it ended (ready, failed, exists), what you did with it (kept, another take was kept, cancelled, stopped, replaced, used), and how many seconds it took.
- Each line also says what it took, for comparing: `kind` (first, fresh, another, change), `drafter` (tool, model, effort), `brief` (a short code that changes whenever the brief's wording does), `runs` (2 when the checks sent it back once), `firstTry`, `resumed`, and the tool's own figures: `turns`, `cost` in dollars, tokens `input`, `cached`, `output` and `thinking`, and `apiSeconds`. OpenCode on a plan may report a cost of 0.
- `drafts/<id>/` holds each one whole: `brief.md` (what the tool was asked), the part's files, `draft.log` (readable steps, with cost where the tool reports it) and `harness.log` (the tool's raw output).

Nothing in the editor is needed for this; it's for looking back at how the tools behave.

## 10. Another take of a part you kept

Go to the line of the part you kept in section 4, `::: <name>`, in normal mode.

**Should happen:** a dim hint at the end of the line says `<M-l>` rerolls, keeps or removes it. It goes when the cursor leaves the line. A catalog part's line, such as `::: quote`, has no hint, and `<M-l>` there does what it always did.

Press `<M-l>`. **Should happen:** a menu with **Reroll…**, **Make it available to every theme** and **Remove from this site…**, and **Fill in the starter** first when the block is empty.

**Reroll.** Choose **Reroll…**, then **Just reroll**. **Should happen:**

- The line stays `::: <name>`. Under it, a spinner says it's drafting another take, with the bracket and wash of a `new:` block. The browser keeps drawing the part as it was meanwhile.
- When it's ready, the browser draws the new take, in every block that uses the part, on every page. The line under it says take 2 of 2, with `<M-p>` `<M-n>`.
- `<M-p>` goes back to take 1, which is the part as you kept it. `<M-n>` comes forward again.
- `testing/parts/<name>/` hasn't changed yet (`git status`).

**Reroll with words on the line.** Type ` : with a softer glow` after the name, so the line reads `::: <name> : with a softer glow`. Leave insert mode, then `<M-l>`. **Should happen:** **Reroll…** then offers **Reroll with “with a softer glow”** in place of **Just reroll**, and **Change something first…** starts with those words as the notes. Either takes the words off the line and drafts take 3 with that change. On your own part's line, those words are never sent to Jev: no ghost text and no note about settings appear for them.

**Keep stays offered.** On take 2 or 3, start another reroll and open the menu while it drafts. **Should happen:** **Keep this take of <name>** is still offered, and keeps the take on screen. The same holds after a reroll fails.

**Keep a take.** On a take other than the first, `<M-l>`, then **Keep this take of <name>**, then **No, just this site**. **Should happen:** the line stays the same and, for a few seconds, a check under it says it's kept. `git diff testing/parts/<name>/` shows the new take's files. The name never changes, since pages use it.

**Go back.** Reroll once more, then `<M-l>` and **Go back to <name> as it was**. **Should happen:** the takes go, the browser draws the part as it was kept, and `testing/parts/<name>/` is unchanged.

**Remove it** (optional: you'd make the part again afterwards). Put the part in a second block somewhere, then `<M-l>` on one of its lines and **Remove from this site…**. **Should happen:** it asks first, saying 1 other block on 1 page uses it. **No, keep it** does nothing. **Yes** removes it. `testing/parts/<name>/` is gone, and a copy is in `testing/.rubric/logs/removed/<name>-<time>/`. The lines that used it are read as words again. To undo: move the folder back to `testing/parts/<name>/`.

A part already in the shared catalog has none of this: removing one of those is a job for git.

## 11. Faster drafts: effort, takes that edit, and resuming

This is for comparing speed against quality as you go. Each draft's line in `testing/.rubric/logs/drafts.jsonl` names the drafter with its effort ("claude with sonnet at low effort") and how many seconds it took.

**Another take starts from the last one.** Reroll any take with a change. **Should happen:** the log (`:Rubric log`, or `draft.log` in its folder) shows the tool editing `part.html` and `part.css` rather than reading files first: their text is in its brief, and the files are already in its folder. Its brief (`brief.md`) has no list of the catalog's parts and no examples, which a first draft still gets. The tool's last line in the log is one sentence saying what it changed.

**A take the tool didn't change** fails with "the tool changed nothing", instead of adding a copy of the take before it.

**Going on with the conversation.** A reroll by the same tool and model as the take on screen continues that take's conversation (a copy of it), so the model has its own earlier work. **Should happen:** its log says "going on with the last take's conversation", and its line in `drafts.jsonl` has `"resumed":true`. Reroll the same take with another drafter (**Change something first…**, then **Drafter**): the log says the last take was drafted by the other model, so this one starts fresh, and `"resumed":false`. If the tool can't find the conversation, the log says so and it starts fresh, without failing. Compare `seconds` and `thinking` between resumed and fresh rerolls of similar changes.

**None of your own setup reaches a draft.** Claude Code runs with only Read, Write, Edit, Glob and Grep, no skills or commands, no `CLAUDE.md` and no memory. OpenCode runs with an empty config folder of its own, so your `~/.config/opencode` (its `AGENTS.md`, agents, skills and MCP servers) stays out. To check after a draft: in its `harness.log`, Claude Code's first line lists `"tools":["Edit","Glob","Grep","Read","Write"]` and `"skills":[]`. An OpenCode draft's reasoning no longer mentions reviewers or delegation, and no `.cache` folder appears among the files it reads.

**A resumed reroll that changes nothing** tries once more without the conversation, and the log says so; its line in `drafts.jsonl` has `"runs":2`.

Try the same change, such as "at more of an angle" on moon-ring, with different drafters, and note the times and which take you'd keep.

## Notes

