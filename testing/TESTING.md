# Live test: the theme line, round two, and parts with no closer

Only what is new since your first try of the theme list: the four notes you gave (sections 1 to 5), and parts that take nothing inside losing their closing `:::` (section 6). The theme list itself passed. The whole run is in [TESTING-full.md](TESTING-full.md).

Write what you find in the **Notes** section at the bottom, numbered as below.

Last updated: 2026-11-10.

## 0. Set up

1. Quit **every** Neovim, so the new plugin loads.
2. If `bun run play` isn't running, start it from the repo root, and open http://localhost:1415/posts/walk/.
3. `nvim testing/rubric.md`, then `:set spell`.

## 1. The extra `:::` goes away

On a new line at the very top, type `::: ` (a `:::` appears below), then `theme p`. Pick `paper` from completion with Tab and Enter, and leave with `jk`.

**Should happen:**

- The `:::` below goes away as soon as you type the space after `theme`.
- The block below the theme line keeps its own closing `:::`.
- The browser takes on Paper.

Then press `u` once.

**Should happen:** the line goes back to how it was, and its `:::` comes back with it. It stays back: you can keep pressing `u` past it.

Redo with `<C-r>`, so the line is `::: theme paper` again.

## 2. A bare `::: theme`

On an empty line, type `::: ` and then `theme`, with no space after it.

**Should happen:**

- The `:::` below stays while you're in insert mode, because the line could still become a part like `theme-switch`.
- It goes when you leave with `jk`.

Delete this second theme line before going on.

## 3. Spell check

Change the line to `::: theme hyde-red palette=dracula pairing=pt-abril-hyde`.

**Should happen:** no squiggles anywhere on the line. Squiggles in the rest of the file are unchanged.

## 4. The hint

Move the cursor onto the theme line, in normal mode and then in insert mode.

**Should happen:**

- A gray hint at the end of the line says `<M-l> opens the theme list`.
- With the cursor on `palette=dracula`, it says `<M-l> opens the palette list`. The same goes for `pairing=`.
- It goes away when the cursor leaves the line.

## 5. `<M-l>` opens the right list

1. In **normal** mode, with the cursor on `hyde-red`, press `<M-l>`. **Should happen:** the theme list opens. Esc closes it.
2. In normal mode on `palette=dracula`, press `<M-l>`. **Should happen:** the palette list opens, and Enter swaps only the palette.
3. In insert mode, type ` scale` at the end of the line, with no `=`, and press `<M-l>`. **Should happen:** the scale list opens, and Enter writes `scale=<name>` with the theme name still there.
4. Change the line to `::: theme large scale editorial`, put the cursor on `scale`, and look at the hint. **Should happen:** it says the *theme* list, because here `scale` is one of your words. `<M-l>` opens the theme list in order for those words. That's one real Jev call.

## 6. Parts with nothing inside have no closer

Sixteen parts take nothing inside, and now have no closing `:::`, like the theme line: `post-list`, `contents`, `divider`, `contact-form`, `breadcrumbs`, `page-contents`, `cover`, `post-meta`, `tags`, `pager`, `related`, `comments`, `share`, `search`, `theme-switch` and `languages`. The old closers are already gone from `testing/rubric.md` and the testing pages.

1. **`rubric.md`.** `search`, `theme-switch`, `breadcrumbs`, `cover`, `post-meta` and `page-contents` have no `:::` under them now. **Should happen:** no notes, and the header, sidebar and the rest of the frame look as before.
2. **Typed by hand.** In `walk.md`, on a new line type `::: ` (a `:::` appears below), then `divider`, and leave with `jk`. **Should happen:** the `:::` below goes when you leave insert mode, and a divider shows in the browser.
3. **Then Enter.** Type `::: ` again, then `contents`, press Enter and type a sentence. **Should happen:** the `:::` goes as you leave the line, and your sentence is ordinary writing after the contents.
4. **Words that start with a part's name.** Type `::: ` then `search for a recipe`. **Should happen:** the `:::` stays. These are words, and words get a block until you accept a pick.
5. **Accepting a pick.** Type `::: ` then `a little line between sections`, wait for the ghost text, and press `<M-l>`. **Should happen:** if the pick is `divider`, the line becomes `::: divider` and the empty `:::` below goes too. One `u` brings both back. If you had written something inside first, the `:::` still goes, and what you wrote stays as ordinary writing under the divider, as the browser already showed it.
6. **Inside a block.** Inside a `::: section`, on a new line, type `::: ` then `divider` and leave with `jk`. **Should happen:** the `:::` that typing added goes, and the section keeps its own `:::`, with no note.
7. **An old closer.** Under `::: divider`, add a `:::` by hand. **Should happen:** a note on it saying divider takes nothing inside, so it has no closing `:::`.

## Notes

