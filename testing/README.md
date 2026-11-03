### Rubric Testing Ground

What to test, and what should happen, is in [TESTING.md](TESTING.md).

A live Rubric site for trying the editor by hand. It uses the universal catalog in `../catalogs/universal`, in the theme named under `[params.rubric]` in `hugo.toml` (paper, papermod or blowfish), and calls the real Jev with `TYPESAFE_API_KEY` from the repo's `.env`.

- `rubric.md` holds the frame around every page: its `:::` lines choose the header, footer and the rest.
- `pages/posts/walk.md` is the post to write in; `pages/posts/first-walk.md` is plain writing, there so the pager, search and post list have a second post.

1. Start the preview, from the repo root:

   ```sh
   bun run play
   ```

   That writes `testing/content/` from `testing/pages/` and `rubric.md` once and serves it at http://localhost:1415/posts/walk/.

   The same terminal prints every call to Jev: the line sent, each part's probability and fit with its settings' answers, and what the line became; a second-pass block for the words after a pin's colon. The full request and response of each call are in `testing/.rubric/jev.jsonl`, which `bun run play` empties when it starts. A line answered from the cache makes no call and prints nothing.

2. In another pane, open a page:

   ```sh
   nvim testing/pages/posts/walk.md
   ```

   The language server rewrites `content/` 100 ms after you stop typing, and the browser shows it about 200 ms later, so the preview follows the buffer without saving. The page changes only what changed, without reloading, and scrolls to follow your cursor; Neovim sends the cursor to the server, which passes it to the page through a relay that `bun run play` runs on port 1416.

Typing `::: ` on an empty line adds the closing `:::` below it, the way autopairs closes a bracket. Turn it off with `close = false` in the plugin's setup.

Keys, in insert mode on a `:::` line:

- `<M-l>` accepts the ghost text: pins the line, or writes a second pass's settings into the pin. Before any ghost text shows, it asks Jev about the line at once instead of waiting for you to pause; Esc does too
- `<M-n>` / `<M-p>` switch between the pick and the runner-up
- `K` in normal mode shows what a line became and why
- `<leader>e` shows the line's note

Jev's answers are cached in `testing/.rubric/cache.json`, per catalog version and theme. Delete it to ask again. A line goes to Jev when you leave it, or after you pause on it for a second. Changing the theme in `hugo.toml` needs no restart: Hugo and the language server both pick it up when the file is saved. To try without Jev, set `args = { "--stub" }` in the plugin's setup.
