# Rubric: the language server and the first slice

Written 2026-10-30. The first thing built is one thin vertical slice through every layer, so that each layer is proven once before any of them is made good. The slice is: a directive typed in Neovim goes to Jev, Jev picks from a small premade catalog, the pick shows as ghost text, the page shows it in Hugo's preview, and the accept key writes the plain form into the file. Everything here serves that slice; what the slice does not need is listed at the end and waits.

## The slice, stated exactly

In a site folder with `hugo server` running and Neovim open on a page:

1. You type `::: a quote from the book, big and centred` and stop.
2. Within a moment, grey text appears at the end of the line: `-> quote size=large align=centre`, and the preview shows the block drawn as a large centred quote.
3. You press the accept key. The grey text becomes real text. The line is pinned and never goes to the network again.
4. You press the swap key instead, and the second pick shows, in the editor and in the preview.
5. You type a line nothing fits, `::: a spreadsheet of my taxes`, and the editor marks it with "nothing in the catalog fits" and the preview shows the line as plain text.
6. You stop Jev (bad key, no network) and the editor says "could not reach Jev" and nothing else changes.

**The preview updates before you accept.** Accepting writes to the file; it does not gate rendering. A pick is judged by seeing it drawn, not by reading `size=large`, so the resolved line is written to Hugo's content as soon as it resolves and the ghost text and the preview change together. The server works from the buffer the editor holds, not from the saved file, so nothing needs saving to see it.

**Done when** all six happen, and the time from the end of typing to ghost text, and to the preview, has been measured on twenty lines.

## What is in the slice

| Piece | In the slice | Size |
| --- | --- | --- |
| A site | One Hugo site with a bare theme: a page template, a stylesheet with the theme slots, no design. | small |
| A catalog | Three parts as shortcodes, `section`, `quote`, `callout`, and the catalog file describing them. Ugly is fine. | small |
| Core | Catalog loader, scanner, plain-form parser, preprocessor, validator, sidecar. Pure functions, tested on fixtures. | medium |
| Jev | Question generator from the catalog file, client, resolver with the truth table, cache. Probed on the live API with a dozen lines. | medium |
| Server | Document sync, debounce, writing content from the buffer, inline completion, diagnostics, hover, completion. | medium |
| Neovim | A server definition in the lspconfig form, inline completion enabled, two keymaps. | tiny |

## The catalog file

The contract. Everything the server does is read from it, and the questions to Jev are generated from it, so the descriptions in this file are the whole of Rubric's "prompting". A sketch of the slice's catalog:

```yaml
name: slice
version: 1

slots: [paper, ink, accent, muted, rule, band]

parts:
  section:
    description: A run of the page set apart from what is around it, as a box or a band.
    children: true
    settings:
      tone:
        type: choice
        default: theme
        values:
          theme: the page's own colours
          band: a tinted band across the page
          dark: inverted, ink on paper becomes paper on ink
      surface:
        type: choice
        default: flat
        values:
          flat: sits in the page with no edge
          raised: lifted off the page with a shadow
      shadow:
        type: level
        default: none
        levels:
          none: no shadow at all
          soft: a faint shadow, barely there
          deep: a strong shadow, clearly floating
  quote:
    description: Words quoted from someone else, set off from the prose.
    children: true
    settings:
      size:
        type: choice
        default: normal
        values:
          normal: the same size as the prose
          large: noticeably larger than the prose, a pull quote
      align:
        type: choice
        default: left
        values: { left: aligned with the prose, centre: centred on the page }
      cite:
        type: text
  callout:
    description: A short aside the reader should notice, beside the main line of the prose.
    children: true
    settings:
      kind:
        type: choice
        default: note
        values:
          note: something worth knowing
          aside: a tangent the reader may skip
          warning: something that could go wrong
```

- `choice`, `level` and `flag` settings each carry a description per value, which becomes the criteria of the Jev question. A `level` is ordered; a `choice` is not.
- `text` and `number` settings are never asked of Jev. They come from the plain form or from the snippet placeholder.
- `children: false` parts (a `divider`, later) are where a nested directive is an error.
- The version is part of the cache key. Change a description, bump the version, and every live line is asked again.

The shortcode for a part reads the same setting names: `{{< quote size="large" align="centre" >}}`. The validator checks a plain form against this file before the preprocessor writes it, so the shortcode can never receive a value the file does not allow.

## The pin format

The plan had the words kept in a trailing comment. The slice uses a simpler form, because it makes accepting the ghost text a plain insertion with no range tricks, and keeps the words visible while deciding:

```markdown
::: a quote from the book, big and centred -> quote size=large align=centre
```

- A line with `->` is pinned. Left of it are the words, right of it is the plain form. Code reads only the right side. The words stay as the record of intent and are what "re-resolve" reads if the catalog changes.
- A line with no `->` whose first token is a part and whose other tokens are `key=value` is plain form, written by hand or by completion.
- Any other line is words, and live.

The ghost text is exactly the text that accepting inserts: ` -> quote size=large align=centre` at the end of the line. Nothing else about the line changes. If the comment form turns out to read better, inline completion items carry a range and Neovim draws a ranged item as an overlay, so the whole line can be replaced on accept instead. Settled in the slice.

## What the editor gets from the server

Every feature is a standard protocol method, so VS Code and the browser editor get them later from the same server with no server change.

| Protocol method | Rubric feature | In the slice |
| --- | --- | --- |
| `textDocument/inlineCompletion` | Ghost text with the plain form of a live directive line. One item per candidate pick, the best first, so the editor's own "next candidate" key swaps between the top two. | yes |
| `textDocument/publishDiagnostics` | "Nothing in the catalog fits", "could not reach Jev", "unknown part", "unknown setting", "value not allowed for size", "a directive cannot go inside a divider", "unclosed block". Warnings, never errors that block anything. | yes |
| `textDocument/hover` | On a directive line: the pick, the two runners-up with their probabilities, and the settings read from each answer. On a plain-form token: the part or setting's description from the catalog. | yes |
| `textDocument/completion` | After `::: ` with nothing typed: the parts, one line each. Inside a plain-form line: setting names for that part, then values for that setting. Each part is a snippet. | yes |
| `textDocument/codeAction` | Pin without ghost text (for editors without inline completion), re-resolve from the words, send to the slow path, drop to plain form. | later |
| `textDocument/documentColor` | A swatch beside theme values in `rubric.md`. Neovim and VS Code draw these natively. | later |
| `workspace/executeCommand` | `rubric.round`, `rubric.new`, `rubric.draft`: the commands behind `:Rubric` that hand things to the harness. | later |
| `textDocument/didOpen`, `didChange`, `didSave` | The document flow below. | yes |

## Completion and snippets

Typing `:::` and a space offers every part in the catalog, with its description as the detail. Choosing one inserts a snippet in the protocol's own grammar, so it works with any completion plugin and needs no snippet engine:

```
quote size=${1|normal,large|} align=${2|left,centre|} cite=${3}
```

Each `choice` setting becomes a choice placeholder with its values; `text` settings become plain placeholders; settings at their default are left out unless the writer tabs to them. Editors that do not draw choice lists show the first value, and completion inside the line still offers the rest.

Inside a plain-form line, completion is contextual: after the part name it offers that part's settings, each with its description; after `key=` it offers that setting's values, each with its description. Typing words instead of a part name offers nothing, by design, because words are for Jev.

## What goes to Jev

One request per live line, generated from the catalog file, with every question bundled. The slice sends roughly this for `::: a quote from the book, big and centred`:

```json
{
  "state": {
    "directive": "a quote from the book, big and centred",
    "page": "post"
  },
  "questions": [
    { "id": "fits", "type": "noul",
      "text": "Does any part in the options fit what `directive` asks for?" },
    { "id": "part", "type": "choice",
      "text": "Which part does `directive` ask for?",
      "options": { "section": "A run of the page set apart…", "quote": "Words quoted from someone else…", "callout": "A short aside…" } },
    { "id": "quote.size", "type": "choice",
      "text": "What size does `directive` ask the quote to be?",
      "options": { "normal": "the same size as the prose", "large": "noticeably larger…" } },
    { "id": "quote.align", "type": "choice", "text": "…", "options": { "left": "…", "centre": "…" } },
    { "id": "section.tone", "type": "choice", "text": "…", "options": { "theme": "…", "band": "…", "dark": "…" } },
    { "id": "section.surface", "type": "choice", "…": "…" },
    { "id": "section.shadow", "type": "score", "levels": { "none": "…", "soft": "…", "deep": "…" } },
    { "id": "callout.kind", "type": "choice", "…": "…" }
  ]
}
```

- The exact wire format comes from the live docs and the SDK, read before this is written. The shape above is what the generator produces; the client turns it into whatever the API wants.
- **State is the directive text and the page kind.** Not the body, not the catalog, not the theme. The parts are the options of the `part` question, because option names are sent to the model and a lookup in a list is not.
- **Every setting of every part is asked**, speculatively, in the one request. Code reads only the answers that belong to the chosen part. Questions are cheap and run in parallel.
- **Each question's text is generated from a template per setting type**, using the part's name and the setting's name: "What `size` does `directive` ask the `quote` to be?" A catalog can override the text for a setting when the template reads badly. The template is the only place wording lives outside the catalog.
- **Code reads the answers through the truth table** in the plan: `fits` below 0.3 is "nothing fits"; between 0.3 and 0.7 is unsettled and the top two parts are offered; above 0.7 the top part is placed, with each setting's top value, and a setting whose Noul sits in the band is left at its default and said so in the hover.
- **The cache key** is the catalog name and version, the page kind, and the exact directive text. The cache is a file in the site folder, `.rubric/cache.json`, so a reopened site does not ask again.
- **The model is pinned** to a versioned id, read from the models page when the client is written, never an alias.
- **An API error is a diagnostic** that says so. It is never read as "no".
- **The probe before the server**: the resolver is run from a script against the live API on a dozen lines, with the payloads kept, before any of it is wired to an editor. That needs your permission and a small budget, and it is where the first wording is tuned.

## What the probe found

Step 4, run 2026-10-31 against `jev-1.14.0`: `bun scripts/probe.ts` over `probe/lines.yaml` (19 lines, tuned on) and `probe/holdout.yaml` (12 lines, checked against). The request sketch above changed in two ways, and the catalog's descriptions changed more than the code did.

- **Round trip: median 140 ms, p90 182 ms, max 292 ms** over 93 calls of 16 questions each. Ghost text can feel like completion; the debounce, not the network, will set the pace.
- **One `fits` Noul for the whole catalog did not separate.** "heads up" scored 0.67 and "a photo gallery" 0.63. It is now one Noul per part, `fits:<part>`, and the resolver reads the one for the part the Choice picked.
- **A Choice or Score sets settings nobody asked for.** "a pull quote" came back `align=centre`, "a dark band" `shadow=deep`. Each choice and level setting now has a `said:<part>:<setting>` Noul: does the line ask for any value other than the default, with those values listed and described. Below 0.3 the setting stays at its default; in the band it stays at its default and is named as unsettled. Asking "what tone" without the values failed the human test: `tone` is jargon.
- **Descriptions are the prompt, and literal.** "Words quoted from someone else, set off from the prose" missed "an excerpt from the letter" (0.51), because the line says neither "quoted" nor "set off". "A quotation of words someone said or wrote" scores 0.83. The section's "a run of the page set apart" let a gallery fit at 0.44. Write each description as what the part *is*, in the words a writer would use, with no qualifier the writer would not say.
- **Value names are sent to the model.** `tone=band` lost to `dark` on "a dark band", because every section is a band; the value is now `tint`. Name a value for what it does.
- **Answers vary a little between runs** (0.67 then 0.62 on the same line). A line on a threshold can flip. The cache makes a line stable after its first answer.
- **Results:** tuning set 19/19 in each of three runs. Held-out 10/12 in each of three runs. The two misses fail safely: "a note about the version this was written for" leaves the line plain with callout and section offered (callout fits 0.62), and "a shaded band behind the next few paragraphs" places a section with tone left at its default and named (said 0.65, value `tint` at 0.92). Both are cases for the fifty-line gate, not for more tuning against lines already seen.
- **The TypeSafe SDK 0.7.0 does not work under Bun**: it locks a reader on the response body, which Bun counts as using it ("Body already used"). Rubric calls the HTTP API with `fetch` (`src/jev.ts`) and keeps the SDK for its types. Worth reporting to TypeSafe.

## The document flow inside the server

1. On open and on every change, the server scans the buffer: code fences tracked, directive lines found, blocks matched to their closers, each line classified as pinned, plain or words.
2. The preprocessor writes `content/<page>.md` from the buffer: pinned and plain lines become shortcode calls, resolved words lines become their cached shortcode calls, unresolved words lines are copied as text, everything else is copied byte for byte. Hugo rebuilds and the preview shows the page as it is in the editor right now.
3. Words lines that are not cached go into a debounce, a few hundred milliseconds from the last change to that line. When it fires, one request per line goes to Jev.
4. When an answer comes back, the resolver runs, the cache and the sidecar are written, the content file is written again, diagnostics are published for that line, and the inline completion for that line is now available. The server also sends a refresh request so an editor that supports it asks again without the cursor moving.
5. The accept key inserts the ghost text. The next change notification shows the line is pinned, and the loop never asks about it again.

Only the server writes to `content/`. The editor's buffer is never written by the server; the accept key is the editor inserting a completion. `hugo server` is started by hand in the slice; the `rubric` command that starts both comes after.

## Neovim

Three things, and no plugin yet:

```lua
-- lsp/rubric.lua, in the lspconfig form
return {
  cmd = { 'rubric', 'lsp' },
  filetypes = { 'markdown' },
  root_markers = { 'rubric.md' },
}
```

```lua
vim.lsp.enable('rubric')
vim.lsp.inline_completion.enable()
vim.keymap.set('i', '<Tab>', function()
  if not vim.lsp.inline_completion.get() then return '<Tab>' end
end, { expr = true })
vim.keymap.set('i', '<C-n>', function() vim.lsp.inline_completion.select() end)
```

The root marker is what makes the server attach only inside a Rubric site, and only to Markdown. The accept key is Neovim's own inline completion accept; the swap key is its own candidate cycling. When the slice works, the plugin that ships is this plus the `:Rubric` commands.

## Steps

| # | Step | Done when |
| --- | --- | --- |
| 1 | The site and the three-part catalog | `hugo server` draws a page that uses all three shortcodes written by hand, and `catalog.yaml` describes them. |
| 2 | Core: loader, scanner, parser, validator, preprocessor | Fixture files with nested blocks, code fences containing `:::`, pinned, plain, words and bad lines all produce the expected content and the expected diagnostics. Line numbers match. |
| 3 | Question generator and resolver | The generator turns the catalog into the request above. The truth table has a test per row, with hand-written answers, asserting outcomes. |
| 4 | Jev probe | A script sends a dozen real lines, keeps every payload and answer, and prints the plain form, the round trip and the runners-up. Wording tuned here. |
| 5 | Server | Attached in Neovim with a stub resolver, the content file follows the buffer, diagnostics appear on bad lines, completion offers the parts and their settings. |
| 6 | Jev in the server | The six scenes in "the slice, stated exactly" all happen. |
| 7 | Measure | Twenty lines, time to ghost text and time to preview, recorded in `docs/measurements.md` with the model id and date. |

**Progress.** Step 1 done 2026-10-31: `catalogs/slice/` (the catalog as a Hugo theme module, with shortcodes that validate against `catalog.yaml`) and `sites/slice/`. Step 2 done 2026-10-31: `src/core/`, in TypeScript on Bun, with fixtures in `test/fixtures/` and a test that builds every fixture's output in Hugo (`bun test`). Steps 3 and 4 done 2026-10-31: `src/core/questions.ts`, `resolve.ts`, `cache.ts`, `src/jev.ts` and `scripts/probe.ts`; see "What the probe found".

Steps 1 to 3 are code with no network and can be written in one session. Step 4 needs the key and the budget. Steps 5 and 6 are where the editor details get settled.

## Measurements the slice produces

- Time from the end of typing to ghost text, and to the preview, per line. This decides whether the loop feels like completion, and whether the debounce is right.
- Top pick correct on the twenty lines, and whether the runner-up was the right one when it was not.
- How often `fits` lands in the unsettled band on lines a person would call clear.

These feed the fifty-line gate in the plan, which is run against the real blog catalog once it exists.

## Not in the slice

- Themes, the root directive, and any design quality in the three parts.
- The `rubric` command, downloading Hugo, the watcher for editors without the protocol.
- Code actions, document colours, the `:Rubric` commands, the slow path, review rounds.
- VS Code and the browser editor. Both are clients of this server; nothing in the slice is Neovim-specific except the three lines above.

## Settled in the slice

- The pin format: `->` or the trailing comment with a ranged item.
- The debounce length, from the measurements.
- ~~The nested-shortcode pattern in Hugo~~: settled 2026-10-31 in step 1. Every part renders `.Inner | .Page.RenderString (dict "display" "block")` with goldmark's `unsafe` on, so a nested part's HTML passes through the outer part's Markdown intact. Parts nest in a section with Markdown, headings and multiple paragraphs inside, all as expected.
- Whether the inline completion refresh is needed or the editor asks often enough on its own.
- The question text template per setting type, from the probe.
