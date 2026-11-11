# Rubric

Writers put `::: words` directives in Markdown; Jev (TypeSafe's model) picks a part from a human-designed catalog; Hugo renders it. Read `docs/plan.md` for the product and the order of work, and `docs/lsp.md` for the slice that is built: the language server, the Neovim plugin, what the live Jev probe found, and what the live test found.

## State

- Steps 0 to 4 are on `main` (branch `slice` was merged in PR #1 on 2026-11-03); step 5, the imported themes, is on branch `themes`, built and not yet reviewed. Step 1 is in its reshaped form: one catalog of every website component in `catalogs/universal/` (57 parts, version 9; `hugo server -s catalogs/universal/page` draws them), Paper as the reference theme with the theme pipeline, and 22 imported skins across 71 combinations (`themes.yaml`; layers in `assets/css/skins/`; a skin's own drawings in `layouts/_partials/skins/<skin>/parts/`), the frame chosen in `rubric.md` and written to `content/rubric-frame/`, the second pass (`::: part : more words`, `resolveRefine` in `src/core/resolve.ts`; accepting puts the part in place of the words, and there is no `->` in the syntax since 2026-11-09), the look settings (`look` in catalog.yaml) on every part, and a live preview that changes in place and follows the cursor (`assets/js/rubric-live.js`, `src/core/live.ts`, the relay in `scripts/play.ts`). The plan's "Order of work" says where each step stands; `docs/lsp.md` has what the three live tests found and what changed.
- Four live tests are done. The fourth, of everything Rubric does, is in `testing/TESTING-full.md` on a new site in `testing/` (`pages/parts.md` with every part, `pages/broken.md` with every mistake); its fixes were retested on 2026-11-08. `testing/TESTING.md` holds only what is new since then; the full checklist is for the next whole run.
- Next: step 5 is done (its probe ran 2026-11-07). Step 6 is built (2026-11-10) as a theme list, not a pick from words: `::: theme paper` in rubric.md, chosen in a picker with a picture of each theme (`catalogs/<catalog>/previews/`, `bun scripts/theme.ts previews`), Jev only ordering it; `testing/TESTING.md` is its live test. The design is under "Themes" in the plan; then step 7, new parts drafted by the writer's harness and reviewed (moved up from stretch on 2026-11-10); then step 8, the `rubric` command that makes it a whole product. Drafting themes by words is still stretch (plan, "Stretch"). `catalogs/blog/` is the earlier blog catalog the universal one grew from, kept for its themes; `catalogs/slice/` is a deliberately ugly three-part stand-in.
- The principles, in order: fast, efficient, beautiful, simple (`docs/plan.md`, Principles).

## Commands

- `bun test` runs everything, including a real headless Neovim (`test/nvim.test.ts`) with the stub resolver. `UPDATE=1 bun test test/fixtures.test.ts` rewrites fixture expectations.
- `bun run typecheck`.
- `bun run play` builds `testing/` and serves it at http://localhost:1415, the live playground, with the cursor relay on 1416. `testing/README.md` has the keys.
- `bun scripts/theme.ts build|check|look|new` builds a catalog's themes from their pieces in `themes/`, checks them, draws them in a browser at three widths (pictures in `catalogs/<catalog>/shots/index.html`; all 71 take about 10 minutes, `look <theme>…` draws fewer), and starts new pieces. `RUBRIC_CATALOG` names the catalog, universal by default. Never edit `assets/css/palettes|pairings|scales/`; they are generated. Parts and `base.css` read slots only. The plan's "How a theme is made" has the design.
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
