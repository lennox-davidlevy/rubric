# Rubric: plan

Written 2026-10-27, the night the idea came, as Warren. Revised 2026-10-28 after a first review. Revised 2026-10-30 after a second, and renamed Rubric the same day: Rubric is a product for other people, not a tool for my own sites; the first thing it makes is blogs; json-render was tried on as the renderer for a day and taken off again, and it stays in `reference/` to learn from. Revised 2026-10-31 with the slice built: principles, functional parts, and the order settled as catalog first, review tooling after.

The language server and the first vertical slice are planned in [lsp.md](lsp.md). The slice is built first.

## The idea

You write words on a page. Where a part of the page should look a certain way, you open a block and say so in your own words:

```markdown
::: a quote from the book, big and centered

Not all those who wander are lost.

:::
```

The site's own look is set once, in a line at the root of the site: *warm, paper and ink, quiet, lots of room to read*. Within a moment the preview shows the page, the way completion fills in code as you type.

**You write the page. The model never does.** Jev picks a part from a catalog that a person designed and reviewed, and fills in its settings. The look is picked the same way, from palettes and type pairings a person designed. Nothing on the page was generated, so nothing is ugly or broken, the same words give the same page every time, and a pick costs a fraction of a cent and comes back in the time it takes to glance at the preview.

## Who it is for, and what it is against

For people who write and want layout to cost a sentence. The first of them keep a blog.

- **Squarespace, Ghost, Substack** make you leave the text to pick a block from a menu. Rubric's menu is a sentence in the text.
- **v0, Lovable, a coding agent** write code. They take a minute, write different CSS each time, and the site drifts. Rubric takes a moment, picks the same thing every time, and the site cannot drift because nothing outside the catalog can appear on it.
- **Bear Blog and plain Markdown** are what Rubric is with no fences at all, and it has to be at least as good there. Most of a blog has no fences. The product is judged first on how a page of plain prose looks, and only then on the magic.

If Rubric is slow or its picks are wrong, people go back to one of these. Speed and pick accuracy are measured early, before anything is built on them (step 3).

## Principles

Four words, in the order they are judged: **fast, efficient, beautiful, simple.** Every piece below answers to them, and when two pull against each other, the earlier one wins.

- **Fast.** A pick shows while you are still looking at the line. Jev answers in about 150 ms; the rest of the wait is pacing, chosen on purpose, and never more than a second or so after you stop typing. Nothing on the writing path waits for an agent.
- **Efficient.** One request per finished line, every question in it, answered once and cached. Half-typed lines are never sent. A day of writing costs a cent.
- **Beautiful.** A page of plain prose in any theme, with no fences, looks designed. Every part defaults to the theme, so a page with a dozen parts and no settings still looks like one thing. Beautiful is the one principle no test can check; the review rounds are its only instrument.
- **Simple.** A part has a handful of settings, each a plain word. A line reads as what it does. The plain form is the whole format: free, offline, exact, in git.

The reason to make a UI in Rubric rather than ask a coding agent for one is that here the work compounds. An agent gives a new thing each time, a minute later, in different CSS, and nobody reviews it. Rubric gives the same thing every time, in a moment, from parts a person looked at; and when nothing fits, the part drafted for you is reviewed once and then kept, for every page after and for everyone. The catalog grows from what people ask for and cannot get.

## The pieces

| Piece | Role |
| --- | --- |
| **The catalog file** | The contract everything else depends on. For one kind of site, every part Rubric can place: a name, a one-line description, typed settings with their values described, whether it takes children, and which assets it brings. Jev's questions, validation, completion, the catalog page and the review rounds read this file and nothing else. Nothing outside the site's catalog can appear on a page. |
| **The parts** | How each entry in the catalog is drawn. A part owns its own HTML, CSS and, when it needs it, JavaScript, loaded only on pages that use it. An animated backdrop is an ordinary part. Parts are written against the theme's slot names, never a literal color. |
| **Hugo** | The first renderer and the whole blog: posts, pages, feeds, dates, drafts, tags, image resizing, a 404, static output with no runtime. A part is a shortcode plus its assets. `hugo server` rebuilds in milliseconds and live-reloads the preview, and it is the published build, so preview and site cannot differ. Rubric downloads a pinned binary on first run; writers never see it. |
| **A theme** | Named values the parts read: `paper`, `ink`, `accent`, `muted`, `rule`, `band`, three font slots, a type scale, a spacing scale, a measure, radii, shadow levels. Several designed themes ship with each catalog, as CSS files that fill the slots. Every catalog reads the same slot names, which is what lets a theme move between catalogs. |
| **Jev** (TypeSafe) | Reads a directive line and answers typed questions about it: which part, which settings, whether anything fits. Judgments from Jev, decisions in code. The model version is pinned, because an alias can change answers without a change to the code, and that would break the cache and the promise that the same words give the same page. |
| **Rubric's core** | One TypeScript program: the scanner, the preprocessor that writes Hugo content, the validator, the Jev client, the cache, the resolver whose truth table turns answers into plain form, and the language server. Every decision is visible, testable logic. |
| **The editors** | A thin client per editor over the one language server: Neovim first, VS Code second, a browser editor beside the preview later for people who do not have an editor. |
| **An agent harness** (Claude Code, OpenCode, Codex) | The slow path: when nothing in the catalog fits, an agent drafts a new part and it goes through review before it joins. Also how catalogs and themes are drafted in the first place. Minutes, not seconds, and never on the writing path. |

The renderer is a choice about who draws the parts, made per catalog behind the catalog file. If a catalog ever needs parts that share state on the page, which is the one thing a script inside a part cannot do, that catalog's parts can be drawn by something else and Rubric does not change. Nothing in sight needs it.

### Functional parts

Some parts do things: a picker (tabs, a filter, a theme switch), a gallery with a lightbox, a backdrop that moves, a post list that sorts. They are ordinary catalog entries with three more rules, so that "functional" never costs "beautiful" or "simple":

- **Every part works with no JavaScript, and the script only improves it.** Tabs are headings and sections without it; a gallery is images; a backdrop is a color. The script loads only on pages that use the part, the way a part's CSS does now (`.HasShortcode`).
- **State lives in the page**: open or closed, the chosen tab, the URL hash, at most `localStorage`. Never a server, never shared between parts. The site stays static output.
- **Motion is a setting with a quiet default.** `motion=none|subtle|lively` or a level, respected as `prefers-reduced-motion`, and `none` on a part that has no reason to move.

The catalog file gains one optional field per part for its script, and nothing else changes shape: Jev's questions, validation and completion read settings the same way whether a part moves or not. The blog catalog carries one functional part from the start (`post-list` or `gallery`), so the shape of script loading is settled early instead of bolted on.

## The directive

A directive is a rubric: a note beside the words saying how they should be set. It is a fenced block. The opening fence carries the request, the closing fence ends the section:

```markdown
::: words, or the plain form
...
:::
```

- **Detection is free, with one rule.** A line starting with `:::` is a directive, unless it is inside a fenced code block, where it is code. The scanner tracks code fences. No model call to find out, and an essay heading like "Warm places" is never mistaken for one.
- **Boundaries are explicit.** The block ends at its closing fence. Blocks nest; the innermost open block closes first. Heading levels stay the writer's.
- **Plain form and words are the same line in two states.** `::: quote size=large align=center` is what the words resolve to. A line is plain form when its first token is a part in the catalog and every remaining token is `key=value`. Anything else is words. Plain form is the source of truth: free, offline, exact.
- **The site-wide directive** lives in `rubric.md` at the site root, not in pages.

A directive that resolves to nothing is left as plain text in the output, and Rubric says why beside it in the editor. Nothing is guessed.

## From source to page

A site is a folder of Markdown files plus `rubric.md`. The writer's files live in `pages/`; Rubric writes Hugo's `content/` from them, and `content/` is generated and ignored.

1. The scanner splits a file into runs of prose and directive blocks, respecting code fences.
2. A resolved directive's opening line becomes one shortcode call, and its closing fence becomes the closing call. The inner Markdown is rendered by the shortcode through `.Inner | .Page.RenderString`, which avoids the mangling the `{{% %}}` form is known for. Settled once in step 1.
3. Every other line is copied byte for byte, so line numbers stay aligned between source and output and the editor can map the preview back to the source.
4. An unresolved directive is left as its fence line in plain text, so it is visible in the preview and nothing is silently lost.
5. The plain form is validated against the catalog file before it is written: the part exists, each setting exists, each value is allowed. Shortcodes also fail loudly on a bad value, so a bad line can never render silently.

A sidecar file beside each source file records what each directive became and why, for the editor and for re-resolving later.

## The loop

1. You finish a directive line. The language server sees typing stop on a `:::` line and waits a few hundred milliseconds. Saving a file also triggers it, from any editor.
2. If the line is pinned or cached, skip to 5.
3. One Jev request for the line, with every question bundled.
4. Code reads the answers through the truth table and caches the result by the exact directive text and the catalog version.
5. The directive is written as a shortcode into `content/`; Hugo rebuilds; the preview refreshes.
6. The editor shows what the line became as ghost text.

Pinned lines never go to the network. Cached lines do not either. Over time most of a site is pinned and the only live traffic is the line being written.

## Ghost text and pinning

The language server shows the resolved plain form as gray text at the end of the directive line, the way completion plugins show a suggestion. It is not in the file.

- **Accept** with a key, and the plain form is written into the source. The line is now pinned: it works offline, never changes, and is in git. The words are kept as a trailing comment, since they record intent and are what re-resolution reads if the catalog changes: `::: quote size=large align=center  <!-- a quote from the book, big and centered -->`.
- **Do not accept**, and the words stay live. Jev re-reads the line when it is edited and the pick can change.
- **Unsettled** picks show the top two and a key chooses between them.

Only the accept key writes to the source. The core never edits a file the editor has open.

[lsp.md](lsp.md) proposes a simpler pin format for the first slice, `::: the words -> quote size=large`, so that accepting is a plain insertion. Whichever survives the slice becomes the format here.

## Jev's questions

The questions are generated from the catalog file. Nothing is hand-written per part, so there is one place to read and tune and nothing to drift:

| In the catalog | Becomes |
| --- | --- |
| The parts, each with its description | One Choice: which part does the line ask for? The descriptions are the criteria. |
| Each part, with its description | One Noul per part: does the line ask for this part? A Choice always picks something, so the picked part's Noul is what tells code when nothing fits. One Noul over the whole catalog did not separate in the probe; see [lsp.md](lsp.md). |
| Each setting with a fixed set of values or levels | One Noul: does the line ask for any value other than the default, with those values described? A Choice or Score picks a value even when the line never mentions the setting. |
| A setting with a fixed set of values, each described | A Choice among the values |
| A setting that is yes or no, with true and false described | A Noul |
| A setting that is a level, with each level described as a situation | A Score |

State for one directive is the directive text and the kind of page it is on (home, post, page). The block's body is not in the state: the body is usually empty when the line is finished, the cache is keyed by the line, and the line says what it wants. The parts are not in the state either; they are the options of the Choice, because option names are sent to the model and a lookup in a list is not.

Every setting question for every part goes in the one request, and code reads only the ones that belong to the chosen part. A request is a few thousand tokens at $0.042 per million, so this is free in practice. There is no cap on questions per request.

Rules that apply, from the TypeSafe guidance:

- One judgment per question. "A gallery inside a boxed section" is two blocks, nested, and two sets of questions.
- Thresholds start at 0.7 and 0.3; the band between is "not settled" and gets its own row in the table.
- A failed API call is an error shown as such, never read as "no" or "nothing fits".
- Assert outcomes in tests, never exact probabilities.
- Read the live docs (docs.typesafe.ai) for request syntax before writing any of it.

## The truth table

| Pinned or cached | API | Something fits | Part pick | Settings | Outcome |
| --- | --- | --- | --- | --- | --- |
| yes, part still in catalog | – | – | – | – | place the recorded part; no request |
| yes, part or setting gone | – | – | – | – | leave the line plain; warn; offer "re-resolve from the words" |
| no | error | – | – | – | leave the line plain; show "could not reach Jev" |
| no | ok | no (< 0.3) | – | – | leave the line plain; offer the slow path |
| no | ok | unsettled | – | – | leave the line plain; show the top two parts to choose from |
| no | ok | yes (> 0.7) | top two close | – | place the top part; ghost text shows both; a key swaps |
| no | ok | yes | clear | one unsettled | place the part with that setting at its default; say which |
| no | ok | yes | clear | clear | place the part with the settings the answers give |

A directive nested inside a part that takes no children is left plain with a warning. Every combination gets an outcome before the code is written.

## Themes

"Same color as the theme" only works if the theme is named values. Every catalog reads the same slots, every theme fills them, and every part is written against them.

The root directive in `rubric.md` is answered the same way as any other line: a Choice among the designed palettes, a Choice among the type pairings, and Scores for spacing and contrast that code maps to the scale values. The model never invents a color. A dozen good palettes and a few pairings are a weekend of taste and they are what make every site look finished. The result is written into the site's Hugo config, and a site can override a value in plain form (`accent=#9a6512`) for the one person in ten who wants to.

## Catalogs

There are several, one per kind of site: **blog** first, then essay, portfolio, docs. A catalog is a Hugo theme module: the catalog file, the parts as shortcodes with their assets, the themes as CSS, and a **catalog page** that renders every part in every setting in each theme. Hugo renders the catalog page from the catalog file in one template. The catalog page is how a catalog is judged, on rendered things, not code.

Catalogs are drafted by an LLM in a harness session and reviewed by a person before anyone writes against them. The point is not that a model cannot write a good part. It is that a part is written once, looked at, and frozen, instead of generated for each request. Reviewed parts are why Jev's picks are accurate (a small set of distinct options) and why nothing on a page is ever broken.

### Review rounds

The catalog page is a review form. Every item has three answers beneath it: **keep**, **drop**, or **a comment**. Verdicts live in `review.yaml` in the catalog folder; Rubric's process writes it from the page, the editor can edit it, and `rubric round` hands it to the harness.

| Your answer | What happens to it |
| --- | --- |
| keep | Frozen. It is the foundation for every later round and does not change at all. |
| comment | Revised according to the comment, and nothing else about it changes. |
| drop, or no answer | Replaced with a new version, informed by what you kept, dropped and said. |

Rounds repeat until everything is kept. Kept items never move, so it converges. The review files plus the final catalog are the **taste record**, and a new part or a new catalog starts from it.

### The slow path

`::: new: a timeline of posts by year` hands the request, the catalog and the taste record to the writer's harness, which drafts the part. It goes through one review round on the catalog page before it joins. A part that is good joins the shared catalog for everyone, which is how the catalog grows with use.

## The blog, as the MVP

A site has a home page, posts, a few pages (about), an RSS feed and a 404. Dates, drafts and tags come from front matter. Nothing else, and all of it is Hugo's default behavior.

The blog catalog, about a dozen parts:

| Part | Settings (sketch) |
| --- | --- |
| `masthead` | title, tagline, nav |
| `hero` | size, image, align |
| `section` | tone (theme, band, dark), surface (flat, raised), width (measure, wide, full) |
| `backdrop` | style (drift, grain, particles, parallax), intensity, speed |
| `callout` | kind (note, aside, warning) |
| `quote` | size, align, cite |
| `figure` | src, caption, width |
| `gallery` | columns, gap |
| `post-list` | count, style (titles, cards, dated) |
| `byline` | date, reading time |
| `buttons` | primary and secondary links |
| `divider` | style |
| `footer` | links, a line of text |

Three to five themes, each genuinely lovely with a page of plain prose and no fences at all. That is the first deliverable and the one the rest is judged against.

## Three tiers, none required

| Tier | Needs | Gives |
| --- | --- | --- |
| Plain | nothing | Directives in the plain form, read by code: free, offline, exact. Catalog, theme, live preview, completion, export. |
| With Jev | a TypeSafe key, or Rubric's proxy later | Directives and the theme in your own words, turned into the plain form. |
| With an agent | any harness the person already uses | New parts when nothing fits; drafting a catalog or theme. |

Rubric keeps working if a provider's terms or prices change, because the plain form is what is saved.

## Editors

One language server, thin clients. The server is where the features live, written once: ghost text with what each directive became, hover with why, a warning on a line Rubric could not place, completion of the plain form when `:::` is typed (parts with one line each, settings as placeholders with their values as a choice list, in the standard snippet format), and code actions (pin, swap to the next pick, send to the slow path). It attaches only in a Rubric site, only to Markdown.

- **Neovim first.** It is where I write, so the MVP gets used every day by its first user, and that is what finds the problems. Neovim 0.12 has inline completion over the language-server protocol (`vim.lsp.inline_completion`, to confirm against the build), so ghost text is the standard mechanism, not extmark tricks. The plugin is an attach rule, the accept and swap keys, and the commands (`:Rubric new`, `draft`, `round`, `open`).
- **VS Code second.** It has inline completion natively and a standard client library, so the extension is a few hundred lines over the same server. This is where most writers who have an editor are.
- **A browser editor third**, beside the preview, for writers who have no editor. It is a CodeMirror client of the same server, and it is the surface the hosted version uses. Built when there is someone to put it in front of, not before.

`rubric` is one process beside `hugo server`: watcher, preprocessor, cache, language server. Saving from any editor updates the preview, with no plugin at all. The command downloads Hugo on first run.

## Order of work

0. **The slice**, in [lsp.md](lsp.md): one thin path through every layer with an ugly three-part catalog, from a line typed in Neovim to Jev to ghost text to Hugo's preview. Decided 2026-10-31, and built the same day: it covers steps 2 and 4 in miniature, and the Jev numbers from it are in lsp.md. It comes first because it tests the two numbers the pitch rests on, the round trip and pick accuracy, before weeks go into a catalog, and because what Jev does with the first descriptions says how the blog catalog's descriptions should be written. It settles the catalog file's shape, the slot names, the pin format and the nested-shortcode pattern that step 1 then builds on.
1. **The blog catalog and three themes**, drafted in a harness session and reviewed by hand, on the catalog page once it exists and on the preview before then. Parts as shortcodes with their assets, one of them functional, the catalog file, the slot names, the catalog page template. Descriptions written the way the slice found works: one plain sentence for the part, one for each value. A page of plain prose in each theme has to be beautiful before anything else is built. This is the hard part of Rubric. The catalog comes before the review tooling (step 6) on purpose: its shape, found by building and using it, is what says what a review form reviews.
2. **Source to page.** The scanner, the preprocessor, the validator, the sidecar, the watcher beside `hugo server`, plain form only. After this step Rubric is a usable static blog tool with no model in it.
3. **The Jev gate.** A fixture of about fifty real directive lines against the blog catalog, including negatives, nested blocks and hard cases, each with the plain form it should resolve to, run against the live API on a small budget. Two numbers come out: the round trip, which decides whether ghost text feels like completion or like waiting, and the top-pick accuracy. If accuracy is not near-perfect the fix is in the part descriptions and the setting descriptions, made here. If the round trip is too slow for ghost text, the loop runs on save instead and the pitch changes, which is better known now.
4. **The language server and the Neovim client.** Ghost text, pinning, completion, diagnostics, code actions, cache.
5. **The theme by words.** The root directive through the palette and pairing Choices.
6. **The slow path, and designing by rounds.** `new`, `round`, `review.yaml`, the taste record, parts joining the shared catalog; "nothing fits" becomes an offer to draft. Also the way a theme is designed iteratively: palettes and pairings go through the same page and the same rounds. On the plan from the start; built after the catalog's shape is known.
7. **VS Code**, then more catalogs (essay, portfolio, docs), the browser editor, the hosted version.

## Reference

Repos cloned into `reference/`, which is ignored by git, and what each is for. Research happens before the step that needs it.

| Repo | Learn from it | Needed by |
| --- | --- | --- |
| `vercel-labs/json-render` (cloned) | `packages/core/src/prompt.ts`: a catalog with descriptions turned into model-facing text, which is what Rubric does with Jev questions. `spec-validator.ts`. How `packages/shadcn` packages a catalog of parts with descriptions. `skills/`: every package ships an agent skill, which Rubric should do for the slow path. | steps 1, 3, 6 |
| `remarkjs/remark-directive` and `micromark-extension-directive` | The `:::name{key=value}` container-directive grammar: nesting, closing, how it coexists with code fences. The plain form could accept that spelling, which would make sources portable to Pandoc too. | step 2 |
| `shadcn-ui/ui`, the registry | How parts are packaged with their files, dependencies and descriptions, and installed into a project. The model for the shared catalog and for what the slow path hands back. | steps 1, 6 |
| `HermanMartinus/bearblog` and Tufte CSS | The zero-fence bar: a few hundred lines of CSS that make plain prose lovely. | step 1 |
| `trys/utopia-core` | Fluid type and space scales, for the scale slots. | step 1 |
| `microsoft/vscode-languageserver-node` | The server library and its sample. Inline completion in the 3.18 protocol. | step 4 |
| `artempyanykh/marksman` | A Markdown language server: attach rules, diagnostics and completion inside Markdown. | step 4 |
| `zbirenbaum/copilot.lua` and Neovim's `runtime/lua/vim/lsp/inline_completion.lua` | Ghost text mechanics in Neovim, accept keys, how the suggestion is shown and cleared. | step 4 |
| `fenneclab/hugo-bin` | Downloading a pinned Hugo binary from an npm package. | step 2 |
| `tailwindlabs/tailwindcss-intellisense` | Completion items that carry a color swatch, for theme and tone values. | step 4 |

Not repos: the TypeSafe cookbooks for function calling and intent routing (docs.typesafe.ai), and Hugo's own documentation on shortcodes, `RenderString` and modules.

## Decided

- Rubric is for other people. My own sites stay in their own repo and are not a step.
- The catalog file is the contract. Parts own their assets. The renderer is chosen per catalog behind it.
- Hugo is the first renderer and the blog. json-render is out of the end result and in `reference/`.
- Catalogs are several designed templates, drafted by an LLM and reviewed by a person, then frozen. Not generated per site.
- The theme is picked, not generated. The model never writes a color.
- The block body stays out of Jev's state, so the cache key and the answer agree.
- One language server; Neovim first, VS Code second, a browser editor and the hosted version later.
- Catalog and functionality first, the review rounds and `new` after, so the catalog's shape instructs the design tooling rather than the other way round. Decided 2026-10-31. Iterative design of themes and catalogs stays on the plan as step 6.
- Functional parts are ordinary parts: they work without JavaScript, keep state in the page, and move only when asked. Decided 2026-10-31.
- The name is Rubric, from 2026-10-30. It was Warren, a place where many small sites are made, until the product stopped being about my sites. A rubric is the note written in red in a manuscript saying how a part should be read or set, which is exactly what the directive line is.

## Open questions

- Source layout inside a site folder: `pages/posts/` and `pages/`, or one folder with front matter deciding.
- Whether the plain form also accepts the directive spelling `::: {.quote size=large}` for portability.
- Whether the cache is committed with the site or local only. Pinned lines make it matter little.
- Whether a part can be site-specific without joining the shared catalog, or whether everything new goes through the pool.
- The Jev key for writers: their own, or a proxy that comes with the hosted version.
