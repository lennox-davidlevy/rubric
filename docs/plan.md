# Rubric: plan

Written 2026-10-27, the night the idea came, as Warren. Revised 2026-10-28 after a first review. Revised 2026-10-30 after a second, and renamed Rubric the same day: Rubric is a product for other people, not a tool for my own sites; the first thing it makes is blogs; json-render was tried on as the renderer for a day and taken off again, and it stays in `reference/` to learn from. Revised 2026-10-31 with the slice built: principles, functional parts, and the order settled as catalog first, review tooling after. Revised 2026-11-06 in a status review: the order of work says where each step stands, the pin format is the one that survived, and step 5 has a proposed shape.

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

- **Accept** with a key, and the plain form is written into the source. The line is now pinned: it works offline, never changes, and is in git. The words stay on the line, since they record intent and are what re-resolution reads if the catalog changes: `::: a quote from the book, big and centered -> quote size=large align=center`. Words after a lone `:` at the end are the second pass, asked only about the pinned part's settings.
- **Do not accept**, and the words stay live. Jev re-reads the line when it is edited and the pick can change.
- **Unsettled** picks show the top two and a key chooses between them.

Only the accept key writes to the source. The core never edits a file the editor has open.

The `->` form came from [lsp.md](lsp.md), so that accepting is a plain insertion at the end of the line. It survived the slice and three live tests, and the trailing-comment form is out.

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
| no | ok | yes (> 0.7) | split (top under 0.5) | – | leave the line plain; show the top two parts to choose from |
| no | ok | fair (0.4 to 0.7) | all but certain (0.9 or more), in a catalog of 15 parts or more | – | place it, as for yes |
| no | ok | unsettled | – | – | leave the line plain; show the top two parts to choose from |
| no | ok | yes (> 0.7) | top two close | – | place the top part; ghost text shows both; a key swaps |
| no | ok | yes | clear | one unsettled | place the part with that setting at its default; say which |
| no | ok | yes | clear | clear | place the part with the settings the answers give |

"Something fits" is the picked part's own `fits` answer; "part pick" is the part Choice. The two rows about how sure the Choice is came from the universal catalog's probe (2026-11-01, `docs/lsp.md`): writers rarely say every word of a description, so the right part's fit often sat between 0.4 and 0.7 while the Choice was all but certain; but in a small catalog the Choice is that sure of the closest part to anything, so the row applies only to large ones. The numbers live in `THRESHOLDS` in `src/core/questions.ts`.

A directive nested inside a part that takes no children is left plain with a warning. Every combination gets an outcome before the code is written.

## Themes

"Same color as the theme" only works if the theme is named values. Every catalog reads the same slots, every theme fills them, and every part is written against them.

The root directive in `rubric.md` is answered the same way as any other line: a Choice among the designed palettes, a Choice among the type pairings, and Scores for spacing and contrast that code maps to the scale values. The model never invents a color. A dozen good palettes and a few pairings are a weekend of taste and they are what make every site look finished. The result is written into the site's Hugo config, and a site can override a value in plain form (`accent=#9a6512`) for the one person in ten who wants to.

**Step 5 as proposed on 2026-11-06, to agree on before it is built.** The first line of `rubric.md` is already the site's look in words; it becomes a `:::` line asked only about the theme: a Choice among the combinations in `themes.yaml`, since a skin (PaperMod, Blowfish) is asked for by its look, and a Choice each among the palettes, pairings and scales in the catalog's `themes/`, with their descriptions as the criteria, so a piece can be swapped. The pin is a plain form naming the combination and any swapped piece, and a site that wants one value by hand writes it there. The pinned line, not `hugo.toml`, is the source of truth: the server already writes the frame page from `rubric.md`, so the theme travels in that page's front matter, and the layout reads it from there before `[params.rubric]`, which stays as the override for a site with no theme line. That keeps the rule that the server writes only `content/` and `.rubric/`, and a theme change reaches the page the way a frame change does, with no restart. Three of each piece were too few for a Choice to mean much, which is why importing themes came first (71 palettes, 20 pairings, 24 scales now), and the probe runs on theme lines before the server asks them. That many may be too many for one Choice; the probe will say, and families first (a skin, then its palettes) is the fallback.

### How a theme is made

Built and settled with Paper, before any second theme, on 2026-11-01, so that each theme after it is a few files and an afternoon of taste rather than CSS.

- **A theme is three pieces**, each a short commented YAML file in the catalog's `themes/`. A **palette** holds the colors: paper, ink, accent, muted, rule, tint, and a dark band's paper, ink and accent. The rest are derived and can be set by hand. A **pairing** holds the fonts and how they are set: weights, leading, tracking, the label case, numerals, the ornament, the code size. Those belong to the faces, since a sans wants heavier, tighter headings than a book serif. A **scale** holds the type sizes (from a smallest and largest body size and ratio, worked out the way Utopia does), the spaces, the measure, the wide width and the radius. `themes.yaml` names the designed combinations. A site names one, and may swap any piece. Step 5 chooses a palette and a pairing separately, which is why they are separate.
- **Dark is a palette, not a mode.** Night will be its own theme. Every theme already carries a dark band, so dark grounds are checked from the first theme.
- **The CSS is generated.** `bun scripts/theme.ts build` turns each piece into one file under `assets/css/`, never edited by hand, and the layout loads one of each. Parts and `base.css` read slots only. A lint refuses a literal color, font or weight in them, and refuses a slot that `catalog.yaml` doesn't list.
- **`check` judges the pieces on paper.** Every slot filled, nothing extra; every pair of text and ground at contrast 4.5 or more, including inside a dark band, a warning callout and a filled button; grounds that must read as different (a tint, a dark band, rules); font files present, every weight used drawable by a face, the preload real. `bun test` runs it, along with a check that the generated CSS is up to date.
- **`look` judges what is drawn.** It draws each theme's catalog page and a stress page at 360, 768 and 1280px in a real browser. The stress page holds the hard cases: long titles, a long address, a long word, a wide table, every kind of inline text, code, footnotes, nesting in a dark band, a hero with no picture, a gallery of one. `look` fails a page that scrolls sideways, writing whose contrast fails against what is really behind it, a missing file or a script error. It saves the pictures with a sheet to look at them side by side. Both layers were tested by putting Paper's old dark-band accent back: `check` and `look` each refused it.
- **`new`** starts a palette, pairing or scale as a copy of Paper's, and adds a combination to `themes.yaml`. The catalog and stress pages for it appear by themselves (a Hugo content adapter).
- **The test of the pipeline is the second theme.** If making Studio or Night needs a change to a part's CSS, the pipeline missed something, and the fix goes into the slots, not the part.

Not done yet: fallback-font metrics (`size-adjust` and the overrides), so the page doesn't shift when the real font arrives. That needs the font's measurements read from the file.

## The universal catalog and skins

Decided 2026-11-01, in conversation, after Paper and the theme pipeline were done. This reshapes "one catalog per kind of site" below.

- **Sites, not apps.** Rubric makes websites from writing. App interfaces (controls wired to data, parts that share state, logins) wait. The catalog says what a part is and never how it is drawn, so an app catalog with another renderer can come later without changing how anyone writes.
- **One catalog of every component a website needs**, in `catalogs/universal/catalog.yaml`, written first as contracts only: name, one-sentence description, a few settings, and a starter body. Its list comes from counting 637 Hugo themes (`docs/research/hugo-themes.md`): 34 parts in the writing and 18 in the frame around it. Inline pieces (badges, icons, keys) need their own syntax and are left out for now.
- **Where a part is chosen** (`place` in the catalog): parts in the writing with a `:::` line in the page; the frame (header, footer, sidebar, breadcrumbs and the like) with the same `:::` lines in `rubric.md`, for every page, which a page may override at its top. A frame part is drawn in its place in the layout, wherever its line sits.
- **Starter bodies** (`body`): once a part is picked, the editor writes what it expects into the empty block (a list of links for a header, a question and answer for a fold), so the writer sees the shape and edits it. Never over anything already written. Parts whose content comes from the site (breadcrumbs, a post list) have none.
- **Controls have a purpose.** No bare input or date picker: a contact form, a newsletter signup, search, a filter. The inputs inside are drawn by the skin.
- **Asking Jev in two steps**, if the probe agrees: which part first (one Choice, whatever the catalog's size), then only the winner's and the runner-up's settings. Asked the current way, one line against the universal catalog is 81 questions. Families first (navigation, media…) only if Jev's choice gets worse with more parts. A `:::` line in a page is never asked about frame parts, nor the reverse.
- **Skins.** A skin is how the catalog looks: tokens (palette, pairing, scale), the frame and plain writing, and, in layers, default parts that read the tokens, the theme's own version of a part where it has one, and small CSS overrides. Every part is available in every skin. Open-source Hugo themes become skins: those with no components give tokens and a frame (PaperMod first), those with many give their own parts too (Blowfish first). The slots grow to carry more of a theme's personality (border, shadow strength, density), learned from those themes' CSS. GPL themes are left out.
- **The probe on it** (2026-11-01, `docs/lsp.md`): the top pick among 34 parts is right 109 times in 112, so no family step. Tuned the same day against three sets (`docs/lsp.md`): descriptions stripped of details a writer would not say, and the truth table now counts how sure the Choice is. Nothing placed wrongly in any set; 21 of 28 right on the last, unseen one, the rest left for the writer to choose. Two steps match one step's accuracy with about 9 questions a line instead of 81, for about 100 ms more. Jev is priced per input token ($0.042 a million), so a line costs about $0.0002 in one step and a quarter of that in two: near nothing either way, so the editor keeps one step for speed, and two steps waits for a catalog that needs it.
- **Drawn, 2026-11-01:** the 34 parts in the writing, as a Hugo module in `catalogs/universal/` built from the blog catalog's machinery (layouts, the theme pipeline, the catalog and stress pages), against richer slots learned from PaperMod, Bear Blog, Coder and Congo: `link`, `heading`, `code-paper` and `code-ink`, `positive`, `warning` and `danger` with their tints and dark-band versions, `font-ui`, `heading-case`, `link-line`, `border`, `control-radius`. Each defaults to what Paper did, so an older palette still works. No part needs a script it cannot do without: tabs read as headings without one, a diagram as its text; a chart is SVG drawn at build time and math is MathML, neither with a script. Diagrams use Mermaid 11.4.1, shipped in the catalog (`static/js/vendor/`, MIT, checked by its hash) and fetched only on pages with a diagram: no outside site is asked, and it works offline. Third-party code ships pinned with the catalog, never from a CDN.
- **The baseline every skin gets** (decided 2026-11-01): notices are colored by kind (a tip `positive`, a warning `warning`, a danger `danger`, each on its own tint), as nearly every theme does. A skin restyles them; it does not drop the distinction.
- **The frame, 2026-11-01:** `rubric.md` is a document the language server handles like a page. Its `:::` lines are asked only about frame parts, a page's only about parts for the writing, and a part in the other place is left as text with a `wrong-place` note. The server writes the frame to `content/rubric-frame/index.md`, a page Hugo reads but never publishes (`src/core/frame.ts`), and the layout draws each part in its place: banner and header on top (search, the light and dark switch and languages inside the header), breadcrumbs and cover above the title, post details under it, sidebar and page contents beside the writing, author, tags, share, related, pager and comments after it (those on dated pages only), footer and social links at the bottom. With no header or footer chosen, the plain ones stay. A page hides frame parts with `hide: [...]` in its front matter, for now, rather than `:::` lines at its top. Dark mode, from the theme switch, is the palette's own dark band for the whole page, so every palette has one. Accepting a pick on an empty block writes the part's starter body with it (tested in a real Neovim).
- **After the first live test, 2026-11-02** (David's notes in `testing/TESTING.md`):
  - Starter bodies never commit to content (`### When — What happened`, not `### 2024`), so a starter cannot contradict the words that picked it.
  - A setting the words ask about with no value that clearly matches gets a note naming the values there are, instead of quietly keeping the default.
  - Pricing: a plan whose title ends in ` *` stands out, any number of them, beside the `featured` setting. A mark has to be on every keyboard: ★ was tried first and dropped for that.
  - A part that needs a value to work (a form's address) says so with a note. `needed` and `site` on a text setting; `form` under `[params.rubric]` gives every form one address.
  - **The second pass**, `::: words -> part settings : more words`. The words after a lone `:` are asked only about the pinned part's settings (and whether they ask for more than any setting does), read as a whole; accepting rewrites the settings in the pin and keeps the words as the record. Settings the words do not mention are left as they are. The part is never asked again: pinned is pinned. Calls stay rare: never asked on opening a page or on a build, only once the writer changes those words; after a pause, like a words line; cached by part, catalog version and tidied words, so the same request is asked once for the whole site. What no setting covers gets a note; shared look settings (shadow, border, emphasis, size) are what will meet most of it, built with the skins; beyond that, the slow path.
- **PaperMod, the first skin, 2026-11-02.** Its colors, fonts and sizes went into three pieces (`papermod` palette, `system-sans` pairing, `papermod` scale) read straight from its `theme-vars.css` and `common/*.css`; the rest is a skin layer, `assets/css/skins/papermod.css`, about 60 lines that read slots only: its header, chevron breadcrumbs, a 40px title, the cover inside the column, a heavy quote rule, tags as pills, the pager as one tinted box with PREV and NEXT, share links in a strip, post lists as bordered cards, and a centered one-line footer. A theme names its skin in `themes.yaml`; the shell loads it after the parts. What PaperMod taught the engine:
  - **A pairing may have no faces**: the reader's own system fonts, nothing to fetch.
  - **Code on a block of its own color** needs its own comment and keyword colors, `code-muted` and `code-accent`: PaperMod draws dark code blocks on a light page, where the page's muted and accent vanish. Both default to the page's own when code sits on the tint, so Paper is unchanged.
  - **What a skin layer cannot do yet:** PaperMod puts the contents in a box at the top of a post, where ours is a column beside it; its list pages have a gray ground; its theme toggle is a moon icon by the site's name, and social links are icons. Each needs the part's markup to differ per skin, which is the second layer (a skin's own version of a part), first needed for Blowfish.
- **Blowfish, the second skin, and the look settings, 2026-11-02.** Decided with David before building: a skin's richer components come along, so what Jev reads depends on the theme. Three rules:
  1. **A skin can add settings to the catalog's parts and parts of its own** (`skins/<skin>.yaml`). While it is the site's skin, they are merged into the catalog Jev reads, and answers are cached per skin.
  2. **Switching skins keeps them in the pin, unused, with a note** (`other-skin`): a setting another skin adds is left out of the page and the part still draws; a part another skin adds stays as text. Switch back and they return. Writing never breaks because the theme changed.
  3. **Anything two skins share moves into the catalog**, with a default drawing, so every skin gets it. Porting every skin's capabilities to every skin (a carousel everywhere) is step 5 of the order of work (decided 2026-11-06): the catalog ends with the same parts for every theme.
  - Blowfish adds `icon` to the callout (six Font Awesome Free icons, CC BY 4.0, vendored with their notice) and a part of its own, `lead`; step 5 moved both into the catalog. It draws its own callout and timeline (`_partials/skins/blowfish/parts/`); `rubric/draw.html` uses a skin's drawing of a part when there is one. Its pieces: `blowfish` palette, `blowfish-sans` pairing, `blowfish` scale, and `assets/css/skins/blowfish.css`. Its own colors were nudged a step in six places to pass the readability check, which now also checks links on tinted boxes.
  - **The look settings** (`look` in catalog.yaml, version 5): `shadow`, `border`, `corners` and `text`, which every part in the writing takes. They are asked once a line, not once a part (8 questions), in the first pass and the second, so "a video with a shadow" and `: rounder, with a soft shadow` work on any part. They become classes on the part (`look-shadow-soft`); base.css draws them and a skin may redraw them. The frame does not take them.
- **Populating, step 5, 2026-11-06.** Twenty-one themes imported, GPL ones left out: 71 palettes, 20 pairings, 24 scales, 71 combinations and 23 skins, all filling one shape. Pieces only, the PaperMod way: Terminal, Bear Blog, Coder, Hyde (9 palettes), Risotto (20 base16 schemes), hello-friend-ng, Archie, Cactus (4), XMin, Anatole, m10c, Blog Awesome, Etch, Yinyang, GitHub Style. With their own components, the Blowfish way: Hugo Book, Congo (7), Relearn (12), Hextra, LoveIt, Geekdoc. Each palette's colors are read from the theme's files; a value that failed the readability check was nudged the least it could be, and the YAML says from what (most palettes have at least one). The pieces are in `themes/`, the layers in `assets/css/skins/`, a skin's own drawings in `layouts/_partials/skins/`. What the imports taught the shape, each with a default that keeps Paper unchanged:
  - **A palette may itself be dark.** Terminal, m10c and the dark base16 schemes have `scheme: dark`, with the band one step away from the page rather than dark against light, so `check` asks less of how far apart the two are.
  - **Dark has its own links, headings and raised boxes** (`dark-link`, `dark-heading`, `dark-raised`), as Bear Blog's and Blog Awesome's do. The band and the dark mode read them.
  - **A colored sidebar or header is not the dark band** (`band`, `band-ink`). Hyde's ochre column drawn as the dark band turned the whole page ochre in dark mode. Band stays in dark mode, and its writing goes dark where white would not read.
  - **Lines can be dashed or dotted** (`rule-style`, `rules` in a scale), for Bear Blog, XMin, Terminal and Cactus. **Body text can be spaced out** (`tracking-body`), for hello-friend-ng.
  - **`check` measures more:** headings on tints and raised boxes, writing and links on every notice tint, links in dark's boxes, and a code block's file name on its own mixed ground. `look` found each of these first, in the new palettes.
  - **A pairing's fonts ship with it**, each with its license in `static/fonts/`, Latin subset only for now, and only the pairing's own page fetches them. Fira Code, Bree Serif and Roboto Flex have no italic, so `check` warns that the browser fakes one; that warning is true and stays.
  - **What the catalog gained (version 6):** `map`, `pdf`, `file-tree` and `progress`, with default drawings every skin gets, agreed with David before they were added, and the callout's `icon`, moved in from Blowfish since most imports have one. `embed` no longer offers a map in its description, since `map` does. Version 8 gave `hero` and `lead` `already: { text: bigger }`, since the first probe read a line's "big" as both the part and a bigger size, and reworded the map after it missed "a street map". Version 9 reworded the map and `hero` after "a map of the whole city" and "a hero with a thin outline" came back as nothing. Version 7 moved Blowfish's `lead` in as well, since Congo has one too, and no real skin now adds a setting or a part of its own, though the mechanism stays. Not added: property lists, animated text and the portfolio parts (skills, experience, education) were left out by choice. The probe has not been run on any of this.
  - **Own drawings, where the markup really differs:** the callouts of Congo, Relearn and LoveIt, and Hextra's file tree with icons. The rest of each skin is a layer of slots, 18 to 95 lines.
- **The order:** the catalog as contracts (done), the probe on it (done), the parts in the writing (done), the frame (done), a live test on the playground (done, with the second pass after it), then default drawings against richer slots, then PaperMod and Blowfish as the first imported skins (both done), then the theme by words.

## Catalogs

*Reshaped on 2026-11-01 by "The universal catalog and skins" above: one catalog of every website component, with themes imported from open-source Hugo themes as skins. The catalog page, the review rounds and the slow path below still hold. The blog table under "The blog, as the MVP" is the sketch the universal catalog grew from, and `catalogs/blog/` is that catalog, kept for its themes.*

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
- **A standalone application** is the other way to reach people without an editor, decided against VS Code and the browser editor once Neovim is done (2026-11-06).

`rubric` is one process beside `hugo server`: watcher, preprocessor, cache, language server. Saving from any editor updates the preview, with no plugin at all. The command downloads Hugo on first run.

## Order of work

Where each step stands, 2026-11-06: step 0 is built and merged to `main`. Step 1 is done in its reshaped form: the universal catalog's parts and frame (now 57), Paper as the reference theme with the theme pipeline, PaperMod and Blowfish as the first imported skins. Step 2 is done but for the `rubric` command: `rubric build` and `rubric watch` exist in `src/cli.ts`, while downloading Hugo and starting both processes do not, and the playground starts Hugo by hand. Step 3 was run against the universal catalog instead of a blog fixture, 112 lines and three tuning sets, with the numbers in lsp.md. Step 4 is done, through three live tests. Step 5 is built on the `themes` branch, 2026-11-06, and waits on David's review, the probe on the five new parts (see "Populating" above). Decided 2026-11-06: populate from open-source Hugo themes and reach total functionality before anything is drafted by words; building your own theme or part is stretch.

0. **The slice**, in [lsp.md](lsp.md): one thin path through every layer with an ugly three-part catalog, from a line typed in Neovim to Jev to ghost text to Hugo's preview. Decided 2026-10-31, and built the same day: it covers steps 2 and 4 in miniature, and the Jev numbers from it are in lsp.md. It comes first because it tests the two numbers the pitch rests on, the round trip and pick accuracy, before weeks go into a catalog, and because what Jev does with the first descriptions says how the blog catalog's descriptions should be written. It settles the catalog file's shape, the slot names, the pin format and the nested-shortcode pattern that step 1 then builds on.
1. **The blog catalog and three themes**, drafted in a harness session and reviewed by hand, on the catalog page once it exists and on the preview before then. Parts as shortcodes with their assets, one of them functional, the catalog file, the slot names, the catalog page template. Descriptions written the way the slice found works: one plain sentence for the part, one for each value. A page of plain prose in each theme has to be beautiful before anything else is built. This is the hard part of Rubric. The catalog comes before the review tooling (step 6) on purpose: its shape, found by building and using it, is what says what a review form reviews.
2. **Source to page.** The scanner, the preprocessor, the validator, the sidecar, the watcher beside `hugo server`, plain form only. After this step Rubric is a usable static blog tool with no model in it.
3. **The Jev gate.** A fixture of about fifty real directive lines against the blog catalog, including negatives, nested blocks and hard cases, each with the plain form it should resolve to, run against the live API on a small budget. Two numbers come out: the round trip, which decides whether ghost text feels like completion or like waiting, and the top-pick accuracy. If accuracy is not near-perfect the fix is in the part descriptions and the setting descriptions, made here. If the round trip is too slow for ghost text, the loop runs on save instead and the pitch changes, which is better known now.
4. **The language server and the Neovim client.** Ghost text, pinning, completion, diagnostics, code actions, cache.
5. **Populate from open-source Hugo themes, into one theme shape.** Import as many as the pipeline allows, from the 637 counted in `docs/research/hugo-themes.md`: those with no components as pieces and a frame, those with many as skins with their own parts, GPL ones left out. Two things grow together. The theme shape: one set of slots (colors, faces, sizes, border, shadow, density and whatever else the imports show a theme needs) that every theme fills, so a theme is the same shape whatever it came from. And the catalog: every component gleaned from any theme joins it with a default drawing, so at the end every theme offers the same parts, as many as the imports yield, and a skin differs only in how it draws them. A part that one skin brings and another lacks is a gap to fill, not a rule, which moves the universal section's "porting every skin's capabilities to every skin" from later into this step. Done when a dozen or more of each piece and a handful of skins all fill the one shape and draw the one catalog.
6. **The theme by words.** The same shape as a part: write what you want in `rubric.md`, and the pick shows in the preview before you accept, with `<M-n>` for the runner-up. If the site has pages, the preview is the writer's own pages restyled, which the live preview already does on a theme switch. If it has none, the preview is a template page, to be designed in this step, that shows what a site in that theme would use: plain prose, a few parts, the frame. The pin names the combination and any swapped piece, and is carried through the frame page, as proposed under Themes.
7. **Total functionality.** The `rubric` command: a new site, a pinned Hugo downloaded on first run, the server and Hugo started together, `build`. A writer goes from nothing to a published site with only the catalog and the imported themes. Done when the playground is a `rubric` site like any other and nothing is started by hand.
8. **Beyond Neovim.** The first goal is Neovim done, since that is where the first user writes. Then something a person without Neovim can use: VS Code over the same server, a browser editor, or a standalone application; which one is decided when Neovim is done.

### Stretch

After total functionality, decided 2026-11-06: build your own theme and catalog. Not before, because a draft is only as good as what it is judged against, and that is the catalog and the themes above.

- **The slow path for parts.** `::: new: a timeline of posts by year` hands the request, the catalog, the slots and the taste record to the writer's harness; `new`, `round`, `review.yaml`, parts joining the shared catalog; "nothing fits" becomes an offer to draft. On the plan from the start.
- **Drafting a theme, never a whole theme from nothing.** A theme is nothing on its own; it exists only as the catalog page and the stress page looking right, which is where it is judged. Most "new" themes are new combinations of pieces, which the words already reach. A genuinely new piece is a short YAML file drafted from the words and the taste record, refused by `check` and `look` before anyone sees it, then one round for the thing no check can judge. Skins are imported, not drafted: a frame and a theme's own drawings are a session with the pipeline, and a look no skin has is a note toward the next import.
- **More catalogs**, for kinds of site the universal catalog does not cover, and apps behind another renderer.

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
- Populate from open-source Hugo themes and reach total functionality first. Building your own theme or part by words is stretch, and a theme is never drafted from nothing: pieces are drafted and judged on the catalog and stress pages, skins are imported. Decided 2026-11-06.
- The name is Rubric, from 2026-10-30. It was Warren, a place where many small sites are made, until the product stopped being about my sites. A rubric is the note written in red in a manuscript saying how a part should be read or set, which is exactly what the directive line is.

## Open questions

- ~~Source layout inside a site folder~~: `pages/posts/` and `pages/`, as the playground has it. Settled in use.
- Whether the plain form also accepts the directive spelling `::: {.quote size=large}` for portability.
- Whether the cache is committed with the site or local only. Pinned lines make it matter little.
- Whether a part can be site-specific without joining the shared catalog, or whether everything new goes through the pool.
- Whether Jev can fill a text setting (`cite`) by choosing among spans of the writer's own words, since it cannot write text. To try when the catalog goes deep.
- Whether a hero replaces the page's own title, since both show today.
- The Jev key for writers: their own, or a proxy that comes with the hosted version.
