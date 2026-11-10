# Live test: accepting replaces your words

Only what changed after the retest on 2026-11-08. The whole run is in [TESTING-full.md](TESTING-full.md).

Write what you find in the **Notes** section at the bottom, numbered as below.

Last updated: 2026-11-08.

## 0. Set up

1. Quit **every** Neovim, so the new plugin and server load.
2. From the repo root, `bun run play`, and open http://localhost:1415/posts/walk/.
3. `nvim testing/pages/posts/walk.md`.

Each of these is a new line in `walk.md`.

## 1. A pick

Type `::: a helpful hint`, wait for the ghost text, and press `<M-l>`.

**Should happen:**

- The ghost text still shows the pick after your words: `-> callout kind=tip`, or close.
- Accepting leaves `::: callout kind=tip` on the line. Your words are gone, with no arrow.
- `u` brings back `::: a helpful hint` in one step.

## 2. A pick with a starter

Type `::: how to install it in three steps` on an empty block, and accept.

**Should happen:** the line becomes `::: steps`, the starter body is written below it, and the cursor is at the end of the starter, not back on the `:::` line.

## 3. The next pick

Type `::: something on the side`. If you get `1 of 2`, press `<M-n>`, then `<M-l>`.

**Should happen:** the line becomes the second pick alone, such as `::: callout`.

## 4. Words after the colon

On the `::: callout kind=tip` line from section 1, add ` : with a soft shadow` and wait.

**Should happen:**

- Ghost text shows `⇒ shadow=soft`, or close.
- Accepting leaves `::: callout kind=tip shadow=soft`. The words after the colon are gone.

## 5. Older lines still work

Type `::: a big quote -> quote size=large` by hand.

**Should happen:** it draws as a quote, with no note and no `── Jev` block, as before.

## Notes

