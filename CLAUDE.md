# Rubric

Writers put `::: words` directives in Markdown; Jev (TypeSafe's model) picks a part from a human-designed catalog; Hugo renders it. Read `docs/plan.md` for the product and the order of work, and `docs/lsp.md` for the slice that is built: the language server, the Neovim plugin, what the live Jev probe found, and what the live test found.

## State

- Everything built so far is on `main` (branch `slice` was merged in PR #1 on 2026-11-03). Plan steps 0 to 4 are done, step 1 in its reshaped form: one catalog of every website component in `catalogs/universal/` (52 parts, version 5; `hugo server -s catalogs/universal/page` draws them), Paper as the reference theme with the theme pipeline, PaperMod and Blowfish as imported skins (`themes.yaml`; layers in `assets/css/skins/`; Blowfish's additions in `skins/blowfish.yaml`, its own drawings in `layouts/_partials/skins/blowfish/parts/`), the frame chosen in `rubric.md` and written to `content/rubric-frame/`, the second pass (`::: words -> part : more words`, `resolveRefine` in `src/core/resolve.ts`), the look settings (`look` in catalog.yaml) on every part, and a live preview that changes in place and follows the cursor (`assets/js/rubric-live.js`, `src/core/live.ts`, the relay in `scripts/play.ts`). The plan's "Order of work" says where each step stands; `docs/lsp.md` has what the three live tests found and what changed.
- Three live tests are done. A fourth is written in `testing/TESTING.md` and not yet run: it checks the fixes from the third (a callout lost on a theme switch, and faster ghost text: `<M-l>` or Esc asks at once, the pause is fitted to the writer, the connection to Jev is kept warm).
- Next: plan step 5, importing open-source Hugo themes as pieces and skins until a Choice among them means something; then step 6, the theme by words, in the shape under "Themes" in the plan; then step 7, the `rubric` command that makes it a whole product. Drafting themes or parts by words is stretch (plan, "Stretch"), decided 2026-11-06. `catalogs/blog/` is the earlier blog catalog the universal one grew from, kept for its themes; `catalogs/slice/` is a deliberately ugly three-part stand-in.
- The principles, in order: fast, efficient, beautiful, simple (`docs/plan.md`, Principles).

## Commands

- `bun test` runs everything, including a real headless Neovim (`test/nvim.test.ts`) with the stub resolver. `UPDATE=1 bun test test/fixtures.test.ts` rewrites fixture expectations.
- `bun run typecheck`.
- `bun run play` builds `testing/` and serves it at http://localhost:1415, the live playground, with the cursor relay on 1416. `testing/README.md` has the keys.
- `bun scripts/theme.ts build|check|look|new` builds a catalog's themes from their pieces in `themes/`, checks them, draws them in a browser at three widths (pictures in `catalogs/<catalog>/shots/index.html`), and starts new pieces. `RUBRIC_CATALOG` names the catalog, universal by default. Never edit `assets/css/palettes|pairings|scales/`; they are generated. Parts and `base.css` read slots only. The plan's "How a theme is made" has the design.
- `bun scripts/probe.ts [lines.yaml]` runs lines against the live Jev API and saves each run under `probe/runs/`. Ask before running it; it costs money and uses the key.
- `bun scripts/pause.ts` replays the writer's typing (`testing/.rubric/keys.jsonl`, logged while `bun run play` runs) and compares pauses before a line is asked: calls, half-typed calls, and the wait.
- `bun scripts/live-repro.ts [blocks] [msPerKey]` types blocks through the user's real Neovim config and compares the buffer, the server's text, `content/` and what Hugo serves. `RUBRIC_HOLD=<ms>` keeps the page up for a browser check.

## Rules

- Write American English everywhere: code, catalog values and descriptions, CSS classes, docs, tests, sample writing, commit messages (`center`, `color`, `gray`, `behavior`, `-ize`, `flashlight`, `sidewalk`). A spelling in a catalog value or description is part of what Jev reads, so changing one bumps the catalog's version.
- `.env` holds `TYPESAFE_API_KEY`. Never read, print or commit it. The server runs with the repo as its working directory so Bun loads it.
- Jev is pinned to `jev-1.14.0` in `src/core/questions.ts`. Question wording and thresholds live there and nowhere else. The TypeSafe SDK is used for types only; calls go through `fetch` in `src/jev.ts` because the SDK breaks under Bun.
- The server works from the editor's text, never the saved file, and writes only `content/` and `.rubric/`. Files are written whole, through `src/core/write.ts`.
- Diagnostics carry a `Code` from `src/core/diagnostic.ts`; add to that union before using a new one.
- The Neovim plugin is `editors/nvim/`, loaded by the user's dotfiles from this path. Do not edit the dotfiles repo without being asked.
- `testing/TESTING.md` is the user's live-test checklist. Update it in the same change as anything they could test by hand: what is new, what to try, what should happen.
- The user tests by hand in Neovim and writes findings in the Notes section at the bottom of `testing/TESTING.md`. Reproduce a reported problem through the real config before theorizing; `scripts/live-repro.ts` is the pattern.
