# Live test: what didn't work last time

A short run. It checks only the fixes from the run on 2026-11-02; everything that worked then is left out. `walk.md` starts empty again, `rubric.md` keeps the frame you built, and the theme is back to Paper.

Write what you find in the **Notes** section at the bottom, numbered by step.

Last updated: 2026-11-06.

## 0. Set up

1. Quit Neovim completely. Two old language servers from before the fixes are still running inside it, and they quit with it.
2. From the repo root:

   ```sh
   bun run play
   ```

   It also starts the relay that carries your cursor to the page, on port 1416. If it says the port is taken, everything else still works; the page just won't follow the cursor.
3. Open http://localhost:1415/posts/walk/ beside Neovim. You'll see "The walk home" with the frame around it, and nothing else yet.

After this, nothing needs a restart, not even switching themes.

## 1. The quote in rubric.md

```sh
nvim testing/rubric.md
```

Type `::: a quote from a book`.

**Should happen:** the note says "nothing for the frame fits; rubric.md holds only what goes around every page, and parts for the writing go in a page".

Then pin it by hand: `::: a quote from a book -> quote`. Now the note says "quote goes in a page; rubric.md holds the frame…". Delete it.

## 2. The page follows your cursor

Open `testing/pages/posts/walk.md` (`:e` is fine; no restart). The browser should switch to the walk page by itself as you do.

Below the front matter, write a paragraph, two `##` sections with a few paragraphs each, and another paragraph: enough that the page scrolls.

**Should happen:**

- Move the cursor up and down: the page scrolls with you, keeping the block you're on about a third of the way down.
- `:e testing/pages/posts/first-walk.md`: the browser opens "The first walk". `:b#` back, and it opens the walk again.

## 3. The pick shows before you accept

At the top of the writing:

```markdown
::: a big opening for the top of the page
```

**Should happen:** as soon as the ghost text shows, and before `<M-l>`, the page shows the hero with its starter text, faded. `<M-l>` writes the starter into the block and it turns solid.

## 4. Nothing reloads

```markdown
::: a flowchart of the route
::: the YouTube video of the walk
::: tabs for summer and winter routes
```

`<M-l>` each one. Put a YouTube link in the video's first line.

**Should happen:**

- The video's starter has a second line, "A line about it, shown under the video." Whatever you write there shows as the caption under the video.
- Start the video playing. Then edit a paragraph, rename a heading, add a word to a tab. **The video keeps playing**, the diagram stays the same size, and the page doesn't jump.
- Edit the diagram itself (change `Finish` to `Home`): only the diagram is drawn again.
- The tabs still switch after you edit them, and there's only one row of tab buttons.

## 5. Two picks

```markdown
::: something on the side
```

**Should happen:** if Jev comes back unsure (last time sidenote 84%, callout 10%), a dim `1 of 2 · <M-n> for the next` sits after the ghost text. `<M-n>` shows the other pick and the hint goes. If Jev is sure this time, there's no hint; say which you got.

## 6. The audio note

```markdown
::: the podcast episode
```

`<M-l>`, then add ` : with a hard shadow and a bright border` after the pin.

**Should happen:**

- The starter has a caption line, "A line about it, shown with the player."
- If Jev judges "hard" and "bright" to ask for more than it can give, the note reads "took shadow=deep border=outlined, but some of this asks for more than audio's settings can say. audio offers shadow none, soft, deep; border none, outlined; …". Last time it sat right at the line, so it may not show; say what you got and whether the message makes sense.

## 7. Half-typed front matter

In `walk.md`'s front matter, type `hide: [comments, pager]` one key at a time.

**Should happen:**

- While it's half typed (`hide: [comm`), the front matter gets a note, "the front matter does not parse yet, so the page shows its last good version", and the page stays as it was.
- **Nothing crashes**: the play terminal keeps going.
- Once the `]` is in, the comments and the pager go from this page.

## 8. Themes without a restart

In `testing/hugo.toml`, change `theme = "paper"` under `[params.rubric]` to `theme = "blowfish"` and save. Leave Neovim and play running.

**Should happen:** the page restyles as Blowfish: slate and blue, extra-bold titles.

Then in `walk.md`:

```markdown
::: a tip with a lightbulb
```

**Should happen:** expect `callout kind=tip icon=lightbulb`, drawn with a lightbulb. Completion after `::: callout ` offers `icon` and its values, in any theme now: the icon moved into the catalog (2026-11-06), since most imported themes have one.

Then an opening paragraph:

```markdown
::: a big opening paragraph
```

**Should happen:** expect plain `lead`, with no `text=bigger`, since "big" is what picked it, drawn larger and softer than the writing. It works in any theme now: it moved into the catalog (2026-11-06), so no part is left that only one theme can draw.

Switch back to `theme = "paper"` and save:

- The callout still draws, and now keeps its lightbulb, drawn Paper's way.
- The lead still draws, larger and softer, in Paper's fonts and colors, with no note.
- Switching to Blowfish again keeps both, and the lead's lines sit a little tighter.

**Fixed since your run:** the callout sometimes vanished after a switch and stayed gone until you edited it. Hugo rebuilt with the new theme a moment before Rubric rewrote the page, Paper failed on the `icon` it didn't know, and the browser kept the old page.

## 9. Faster ghost text

**New.** Restart Neovim once to get the new plugin (play can keep running).

Type a new line and press `<M-l>` as soon as you finish, without pausing:

```markdown
::: a quote from someone famous
```

**Should happen:**

- The ghost text shows almost at once, about a quarter of a second after `<M-l>`, instead of after a second's pause. Press `<M-l>` again to accept it.
- Esc on a line you've just typed asks at once too: the page shows the pick, faded, right away.
- If you just pause instead, it still works as before. After you've typed a few lines, the pause shortens to fit how fast you type, never under 0.4 s.
- The calls shouldn't go up. Each line should still show one `── Jev` block in the play terminal. Watch for half-typed words in them (like "a flowchart of the ro"), and note any.

Your typing is logged to `testing/.rubric/keys.jsonl`: when each `:::` line was typed, and its words. After a session, `bun scripts/pause.ts` shows how many calls each pause would have made on your real typing. If the fitted one sends more than the old one, say so and we'll change it.

## 10. The imported themes

**New.** No restart needed, and it can wait until the rest is done. In `testing/hugo.toml`, change `theme` under `[params.rubric]` and save, once each. Every name below should restyle `walk.md` in place. Look for anything hard to read, or that looks broken. A full list of the 71 is in `catalogs/universal/themes.yaml`.

- `terminal`: near-black, amber, monospace, a filled block for the name, dashed lines.
- `bear`: almost nothing, Verdana, one blue.
- `hyde-teal`: a colored column on the left with a huge display name. On a phone width, it sits on top.
- `gruvbox-light`, `dracula`, `solarized-dark`: text-file look, `#` marks on headings, `[name] $` as the site's name.
- `github`: the code-host look, tinted bar, thin lines.
- `relearn-blue`: a dark menu on the left, notices with a filled title.
- `hextra`: hairlines and 8px boxes.
- `geekdoc`: a deep teal bar, a geometric sans for headings.

**Should happen:** dark palettes such as `terminal` stay dark. If your frame has the light and dark switch, its dark setting moves them to a ground one step away, not to a light page.

All 71 at once, side by side: `bun scripts/theme.ts look` (about 10 minutes), then open `catalogs/universal/shots/index.html`.

## 11. Four new parts

**New.** Restart Neovim once, since the catalog changed. In `walk.md`, try each. They should be picked and drawn in any theme:

```markdown
::: a map of where the walk starts
51.5055, -0.0754

By the river.
:::

::: the route as a PDF to read here
/files/route.pdf
:::

::: the files in this project as a tree

:::

::: bars showing how far along each goal is

:::
```

**Should happen:**

- `map`, with `zoom` from words like "a street map" or "zoomed in close". A frame from OpenStreetMap with a marker, and a link under it. Move your cursor off and back: no reload.
- `pdf`. The frame stays empty until `/files/route.pdf` is a real file in the site's `static/`, and the link under it works once it is.
- `file-tree` and `progress` write a starter body you edit. In `hextra`, the tree has folder and file icons.
- These are Jev's first look at these parts: the words above have not been run through the probe. Note any line that picks the wrong part, especially a map that picks `embed`.

## Afterwards

Stop play with Ctrl-C; the last line counts the calls to Jev.

## Notes

for this: 

```
::: the podcast episode -> audio shadow=deep border=outlined : with a hard shadow and bright border 
/audio/

A line about it, shown with the player.
:::
```

this diagnostic:

```
Diagnostics:
1. took shadow=deep border=outlined, but some of this asks for more than audio's settings can say. audio offers shadow none, soft, deep; border none, outlined; corners theme, square, round; text normal, smaller, bigger [beyond-part]
```

The first time i switched theme from blowfish back to paper after the lightbulb tip, the callout disapeared, ia m pretty sure, and when i switched it back is was still gone, until i made a change in the content of the tip. once i did, i switched back and forth between themes and it worked well.


So for this test, most everything was perfect. I do have a request, and I want to really consider how we could do it, but i would prefer the jev completion to be faster, almost instant, without decreasing efficiency, nor increasing calls to jev, and without making a dozen calls every time i type. I feel like there is a clever way to do this, but i cant think of one. I know we are just waiting n ms to hit jev and return a response to ensure we dont make a milllion calls, so lets discuss.
