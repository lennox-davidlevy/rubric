### Rubric Testing Ground

A live Rubric site for trying the editor by hand. It uses the slice catalog in `../catalogs/slice` and calls the real Jev with `TYPESAFE_API_KEY` from the repo's `.env`.

1. Start the preview, from the repo root:

   ```sh
   bun run play
   ```

   That writes `testing/content/` from `testing/pages/` once and serves it at http://localhost:1415/posts/playground/.

2. In another pane, open the page:

   ```sh
   nvim testing/pages/posts/playground.md
   ```

   The language server rewrites `content/` 300 ms after you stop typing, so the preview follows the buffer without saving.

Typing `::: ` on an empty line adds the closing `:::` below it, the way autopairs closes a bracket. Turn it off with `close = false` in the plugin's setup.

Keys, in insert mode on a `:::` line:

- `<M-l>` accepts the ghost text and pins the line
- `<M-n>` / `<M-p>` switch between the pick and the runner-up
- `K` in normal mode shows what a line became and why
- `<leader>e` shows the line's diagnostic

Jev's answers are cached in `testing/.rubric/cache.json`. Delete it to ask again. A words line goes to Jev when you leave it, or after you pause on it for a second, so the ghost text shows about a second after you stop typing. To try without Jev, set `args = { "--stub" }` in the plugin's setup.
