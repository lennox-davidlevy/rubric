### Rubric Testing Ground

What to test, and what should happen, is in [TESTING.md](TESTING.md).

A live Rubric site for trying the editor by hand. It uses the blog catalog in `../catalogs/blog`, in the Paper theme, and calls the real Jev with `TYPESAFE_API_KEY` from the repo's `.env`.

1. Start the preview, from the repo root:

   ```sh
   bun run play
   ```

   That writes `testing/content/` from `testing/pages/` once and serves it at http://localhost:1415/posts/blog/ (the blog catalog's scenes) and http://localhost:1415/posts/playground/ (the older page, from the slice).

   The same terminal prints every call to Jev: the line and page sent, each part's probability and fit with its settings' answers, and what the line became. The full request and response of each call are in `testing/.rubric/jev.jsonl`, which `bun run play` empties when it starts. A line answered from the cache makes no call and prints nothing.

2. In another pane, open the page:

   ```sh
   nvim testing/pages/posts/blog.md
   ```

   The language server rewrites `content/` 100 ms after you stop typing, and the browser shows it about 200 ms later, so the preview follows the buffer without saving.

Typing `::: ` on an empty line adds the closing `:::` below it, the way autopairs closes a bracket. Turn it off with `close = false` in the plugin's setup.

Keys, in insert mode on a `:::` line:

- `<M-l>` accepts the ghost text and pins the line
- `<M-n>` / `<M-p>` switch between the pick and the runner-up
- `K` in normal mode shows what a line became and why
- `<leader>e` shows the line's diagnostic

Jev's answers are cached in `testing/.rubric/cache.json`. Delete it to ask again. A words line goes to Jev when you leave it, or after you pause on it for a second, so the ghost text shows about a second after you stop typing. To try without Jev, set `args = { "--stub" }` in the plugin's setup.
