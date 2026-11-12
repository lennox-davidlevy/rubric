### Rubric Testing Ground

What to test, and what should happen, is in [TESTING.md](TESTING.md).

A live Rubric site for trying the editor by hand. It uses the universal catalog in `../catalogs/universal`, in the theme named under `[params.rubric]` in `hugo.toml` (any of the 71 in `themes.yaml`), and calls the real Jev with `TYPESAFE_API_KEY` from the repo's `.env`.

- `rubric.md` holds the frame around every page: its `:::` lines choose the header, footer and the rest. It starts empty.
- `pages/posts/walk.md` is the post to write in, and starts empty.
- `pages/parts.md` is every part for the writing, filled in, in plain form, for looking at themes. `pages/broken.md` is every mistake a line can make.
- `pages/posts/reservoir.md`, `night-bus.md` and `first-walk.md` are finished posts, for the frame, the pager, related posts and search. `pages/about.md` is a page with no date, and `about.fr.md` its translation, for the language switch.
- `static/` holds what the parts need: pictures, logos, a PDF, a GPS track, a sound and a video.

1. Start the preview, from the repo root:

   ```sh
   bun run play
   ```

   That writes `testing/content/` from `testing/pages/` and `rubric.md` once and serves it at http://localhost:1415/.

   The same terminal prints every call to Jev: the line sent, each part's probability and fit with its settings' answers, and what the line became; a second-pass block for the words after a pin's colon. The full request and response of each call are in `testing/.rubric/jev.jsonl`, which `bun run play` empties when it starts. A line answered from the cache makes no call and prints nothing.

2. In another pane, open a page:

   ```sh
   nvim testing/pages/posts/walk.md
   ```

   The language server rewrites `content/` 100 ms after you stop typing, and the browser shows it about 200 ms later, so the preview follows the buffer without saving. The page changes only what changed, without reloading, and scrolls to follow your cursor; Neovim sends the cursor to the server, which passes it to the page through a relay that `bun run play` runs on port 1416.

Typing `::: ` on an empty line adds the closing `:::` below it, the way autopairs closes a bracket. Turn it off with `close = false` in the plugin's setup.

Keys, in insert mode on a `:::` line:

- `<M-l>` accepts the ghost text: puts the part in place of your words, or writes a second pass's settings into the part and drops those words. `u` brings the words back. Before any ghost text shows, it asks Jev about the line at once instead of waiting for you to pause; Esc does too
- `<M-n>` / `<M-p>` switch between the pick and the runner-up, in the ghost text and on the page
- On a `::: new: what the part should be` line, `<M-l>` drafts a new part (with Claude Code or OpenCode: the default drafter, or another chosen for one draft as it starts; `:Rubric harness` chooses the default's tool, model and effort, `:Rubric model` its model and effort; both are kept). The line shows a spinner while it drafts, a diamond when it's ready, and a check once kept, then asks keep, reroll or cancel once it's drawn in the browser, and on keep whether every theme gets it. Words nothing in the catalog fits offer this as their ghost text. A hint at the end of the line says so
- On `::: theme` in `rubric.md`, `<M-l>` in insert or normal mode (or `:Rubric theme`) opens the theme list, and a hint at the end of the line says so: names on the left, a picture, colors and type on the right, and the page in the browser takes on the theme under the cursor. Enter chooses it; Esc puts the old one back. Words after `theme` put the list in order. On `palette=`, `pairing=` or `scale=`, it opens that piece's list
- `K` in normal mode shows what a line became and why
- `<leader>e` shows the line's note

Jev's answers are cached in `testing/.rubric/cache.json`, per catalog version and theme. Delete it to ask again. A line goes to Jev when you leave it, or after you pause on it for up to 0.6 s. Changing the theme in `hugo.toml` needs no restart: Hugo and the language server both pick it up when the file is saved. To try without Jev, set `args = { "--stub" }` in the plugin's setup.
