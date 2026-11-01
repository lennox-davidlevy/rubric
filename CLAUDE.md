# Rubric

Writers put `::: words` directives in Markdown; Jev (TypeSafe's model) picks a part from a human-designed catalog; Hugo renders it. Read `docs/plan.md` for the product and the order of work, and `docs/lsp.md` for the slice that is built: the language server, the Neovim plugin, what the live Jev probe found, and what the live test found.

## State

- Branch `slice` holds everything built so far (plan step 0, which covers steps 2 and 4 in miniature). `main` has only the first commits.
- Now in plan step 1: the blog catalog and three themes. The parts are drawn; Paper is finished as the reference theme, with the theme pipeline. Then the direction changed (plan, "The universal catalog and skins"): one catalog of every website component, as contracts in `catalogs/universal/`, probed before anything is drawn; skins imported from open-source Hugo themes take the place of Studio and Night. The slice catalog in `catalogs/slice/` is a deliberately ugly three-part stand-in.
- The principles, in order: fast, efficient, beautiful, simple (`docs/plan.md`, Principles).

## Commands

- `bun test` runs everything, including a real headless Neovim (`test/nvim.test.ts`) with the stub resolver. `UPDATE=1 bun test test/fixtures.test.ts` rewrites fixture expectations.
- `bun run typecheck`.
- `bun run play` builds `testing/` and serves it at http://localhost:1415, the live playground. `testing/README.md` has the keys.
- `bun scripts/theme.ts build|check|look|new` builds a catalog's themes from their pieces in `themes/`, checks them, draws them in a browser at three widths (pictures in `catalogs/blog/shots/index.html`), and starts new pieces. Never edit `assets/css/palettes|pairings|scales/`; they are generated. Parts and `base.css` read slots only. The plan's "How a theme is made" has the design.
- `bun scripts/probe.ts [lines.yaml]` runs lines against the live Jev API and saves each run under `probe/runs/`. Ask before running it; it costs money and uses the key.
- `bun scripts/live-repro.ts [blocks] [msPerKey]` types blocks through the user's real Neovim config and compares the buffer, the server's text, `content/` and what Hugo serves. `RUBRIC_HOLD=<ms>` keeps the page up for a browser check.

## Rules

- Write American English everywhere: code, catalog values and descriptions, CSS classes, docs, tests, sample writing, commit messages (`center`, `color`, `gray`, `behavior`, `-ize`, `flashlight`, `sidewalk`). A spelling in a catalog value or description is part of what Jev reads, so changing one bumps the catalog's version.
- `.env` holds `TYPESAFE_API_KEY`. Never read, print or commit it. The server runs with the repo as its working directory so Bun loads it.
- Jev is pinned to `jev-1.14.0` in `src/core/questions.ts`. Question wording and thresholds live there and nowhere else. The TypeSafe SDK is used for types only; calls go through `fetch` in `src/jev.ts` because the SDK breaks under Bun.
- The server works from the editor's text, never the saved file, and writes only `content/` and `.rubric/`. Files are written whole, through `src/core/write.ts`.
- Diagnostics carry a `Code` from `src/core/diagnostic.ts`; add to that union before using a new one.
- The Neovim plugin is `editors/nvim/`, loaded by the user's dotfiles from this path. Do not edit the dotfiles repo without being asked.
- `testing/TESTING.md` is the user's live-test checklist. Update it in the same change as anything they could test by hand: what is new, what to try, what should happen.
- The user tests by hand in Neovim and writes findings in `notes-on-test.md`. Reproduce a reported problem through the real config before theorizing; `scripts/live-repro.ts` is the pattern.
