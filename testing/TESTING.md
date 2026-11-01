# Live test: build a post from a blank page

You start with an empty post, `testing/pages/posts/test.md`, and build it up one step at a time, the way a writer would. Each step says what to type, what should happen, and what to notice about how it feels. Write what you find in `notes-on-test.md` at the repo root, numbered by step (for example `7. the second choice was callout, but M-n did nothing`).

This file is kept up to date as Rubric changes.

Last updated: 2026-11-01, after the nested closer, completion after deleting, and the Jev count.

**New since the last test:**

- Typing `::: ` inside another block now adds its own closer, even when the outer block's `:::` is right below (step 11).
- Deleting a setting's value brings the menu back with the allowed values; before, it came back only after you typed a letter (step 10).
- The play terminal numbers each Jev call (`── Jev #3`) and prints the session's total when you stop it with Ctrl-C.

## How to read what you see

- **Neovim**: the ghost text after a `:::` line is Jev's pick. `<M-l>` accepts it and pins the line. Coloured underlines are notes on the line; `<leader>e` shows the message and `K` (in normal mode) explains what the line became.
- **The play terminal**: a `── Jev` block each time a line is sent, ending in `result`. `placed` means it's on the page. `unsettled` means Jev wasn't sure and it's waiting for you.
- **The browser**: follows the buffer about half a second after you stop typing. You never need to save for the preview.
- **A `:::` line shown as raw text on the page** means the line isn't placed yet: Jev hasn't answered, wasn't sure, or nothing fits. It should only last until the answer comes, or until you choose.

A line you've already sent is remembered (`testing/.rubric/cache.json`), so sending the same words again is instant and prints nothing in the log.

## 0. Set up

1. Stop any old `bun run play` with Ctrl-C, then from the repo root:

   ```sh
   bun run play
   ```

2. In another pane:

   ```sh
   nvim testing/pages/posts/test.md
   ```

   If Neovim was already open, quit it and start it again, so the language server runs the current code.

3. Open http://localhost:1415/posts/test/ beside it. It shows the title "The walk home" and nothing else.

## 1. Just write

Below the front matter, type a paragraph, any paragraph. For example:

```markdown
Two miles past the reservoir, every evening, whatever the weather.
```

**Should happen:** the paragraph shows in the browser about half a second after you stop typing, without saving. Nothing prints in the play terminal: plain writing never goes to Jev.

**Notice:** whether the preview feels like it keeps up, or lags. It should show about a third of a second after you stop. Hugo needs about 0.2 s of that, so it won't be instant like a React hot reload.

## 2. The opening

Go to the empty line above your paragraph and type `::: ` (with the space).

**Should happen:** a closing `:::` appears below the line straight away, the way a bracket closes.

Now type the words, then stop:

```markdown
::: a big opening for the top of the page
```

**Should happen:**

- About a second after you stop, a `── Jev` block prints, ending `result placed ::: hero`.
- The ghost text ` -> hero` appears at the end of the line.
- The browser shows the hero, even before you accept it.

Press `<M-l>`. The line becomes `::: a big opening for the top of the page -> hero`. That is pinned: it is never sent to Jev again.

Inside the block, between the two `:::` lines, type:

```markdown
# The walk home

Notes from the same two miles, every evening for a year.
```

**Should happen:** a large title with its line under it, at the top of the page.

**Known gap:** the post's own title and date still show above the hero, so "The walk home" appears twice. The layout doesn't yet hand the top of the page to a hero. Say what you'd want: the hero replacing the title, or the hero kept for home and plain pages.

**Notice:** how long the wait for the ghost text feels. Also, while Jev is thinking, the raw `::: a big opening…` line may show on the page for a moment.

## 3. Change your mind by hand

Put the cursor at the end of the pinned line, after `hero`, and type a space.

**Should happen:** completion offers hero's settings (`size`, `align`, `image`). Choose `align`, then after the `=` choose `centre`. The line reads `-> hero align=centre`, and the title centres in the browser.

Now add a picture to it. Type ` image=` after `centre`.

**Should happen:** completion lists the site's pictures by the address the page uses: `/images/sample.jpg`, `/images/path.png`, `/images/gallery/…`. Your own pictures go in `testing/static/images/`; one added while you work shows up the next time you complete. Choosing one writes it in quotes: `image="/images/sample.jpg"`. A picture appears with the hero.

Then break it on purpose: change it to `/image/sample.jpg`. A warning appears on the address, "no file at /image/sample.jpg in static/". The page still draws, without the picture.

You may also see suggestions like `config.sh` or `loader/`. Those come from your own path completion (cmp-path), which reads a leading `/` as the root of your computer, not the site. Rubric's suggestions are the ones marked as files with full `/images/…` addresses.

Jev never fills `image`, `cite`, `summary`, `count` or `tag`. Those are always yours to type.

**Notice:** is it clear the right of the `->` is yours to edit, and the left is just your words?

## 4. Headings and a table of contents

Below your paragraph, write two short sections:

```markdown
## The reservoir

The water is high this year, and the path along it is soft.

## The canal

Past the gasworks, where the herons wait.
```

Then, on a line above `## The reservoir`, type:

```markdown
::: a table of contents
```

**Should happen:** placed as `contents`. A box headed "Contents" lists your two headings as links that jump to them. Add a third `##` heading later and it shows up in the box.

## 5. Notes for the reader

At the end of "The reservoir" section, type:

```markdown
::: warn them the path floods in winter
The lower path is under water from December to March.
:::
```

At the end of "The canal" section:

```markdown
::: a tip for the reader
Bring a torch after October.
:::
```

Leave both unpinned this time.

**Should happen:** "Warning" and "Tip" boxes. An unpinned line that was placed shows on the page just the same as a pinned one. Pinning only freezes it.

**Notice:** whether typing the body inside the block feels the same as typing anywhere else.

## 6. A quote, with who said it

```markdown
::: a pull quote, big
You can't be early for a tide.
:::
```

**Should happen:**

- Placed as `quote size=large`, noticeably bigger than the prose.
- There may be a faint hint on the line, "left at the default: align". That means Jev wasn't sure the words asked for an alignment, so it left it alone. `K` on the line explains.

Pin it with `<M-l>`, then add ` cite="my grandmother"` after `size=large`. The name shows under the quote.

Then check the old stale-preview bug: change the name in two bursts, pausing about half a second in the middle (`my grand`, pause, `ma`). The page must end on the whole name, every time, without a manual reload. Try it a few times, and with the body text too.

## 7. When Jev isn't sure

```markdown
::: a box lifted off the page
Writing inside a raised box.
:::
```

**Should happen** (last time this line came back unsure):

- The log says `unsettled`, with a section and a callout.
- The line gets a note, "not sure what this asks for: section edge=raised or callout".
- The ghost text shows the first choice, and `<M-n>` / `<M-p>` switch between the two.
- The page shows the raw `:::` lines until you pick one. Pick with `<M-l>`.

If it came back `placed` instead, it shows a box with a shadow straight away. That's fine; note which one you got.

**Notice:** is it obvious that this line is waiting on you, and what to do about it?

## 8. Pictures

One wide picture:

```markdown
::: one wide photo with a caption
![The canal by the gasworks](/images/sample.jpg)

The canal by the gasworks, early on a Sunday.
:::
```

Then a set:

```markdown
::: a few photos from the walk, two across
![The canal at first light](/images/gallery/sample-1.jpg)
![A gate on the reservoir path](/images/gallery/sample-2.jpg)
![Reeds after rain](/images/gallery/sample-3.jpg)
![The old pumping station](/images/gallery/sample-4.jpg)
:::
```

**Should happen:**

- While typing the addresses, completion offers the site's pictures after `](` too, and a wrong address gets the same warning as in step 3.
- The figure is wider than the writing, with the caption under it.
- The gallery is two pictures across.
- In the browser, click a picture. It opens large on a dark ground, with "1 of 4", ‹ › buttons and its caption.
  - The arrow keys move through the pictures.
  - Esc, ×, or a click on the dark ground closes it.
  - It fades in and out. Pin the line and add `motion=none` to make it open at once.

## 9. Something the catalog doesn't have

```markdown
::: a map of the walk
:::
```

**Should happen:** the log says `nothing-fits`. There's no ghost text, and the line gets a warning, "nothing in the catalog fits". The page shows it as raw text. Delete the block afterwards.

**Notice:** whether the warning tells you enough, or leaves you stuck.

## 10. A mistake

Type a plain form with a value the catalog doesn't have:

```markdown
::: callout kind=aside
A tangent.
:::
```

**Should happen:** a warning on `aside`, and `<leader>e` lists the allowed values (note, tip, warning). The page shows the raw lines. Delete `aside` with backspace, and completion offers the three values straight away. Choose one and the callout appears.

## 11. One part inside another

```markdown
::: a dark band across the whole page
The quiet part of the evening, after the last bus has gone.

::: a quote
Nobody walks this way after dark.
:::
:::
```

Type it top to bottom, and watch what the auto-closer does on the inner `::: `. Also try it the other way: write the band first, then go back inside it, onto the line directly above its closing `:::`, and type `::: a quote`. Either way, the quote gets its own closer.

**Should happen:**

- The band is dark, runs edge to edge, and has light writing.
- The quote inside it is light on dark too.
- Each `:::` closes the block it belongs to.

**Notice:** whether the closer helps or gets in the way when nesting.

## 12. The ending

```markdown
::: a break in the writing with a little ornament
:::

::: two buttons, read more and about, centred
[Read more](/posts/) [About](/)
:::

::: the latest posts as cards
:::
```

**Should happen:**

- The divider is a small printer's mark, not a line.
- Two buttons, centred, with the first one stronger. This line came back unsure last time; if it does again, choose as in step 7.
- The other posts show in boxes, each with a summary. The page you're on is never among them.

## 13. Close and reopen

Save with `:w`, quit Neovim, and open the page again.

**Should happen:** nothing prints in the play terminal, because every line is remembered, and the page looks the same.

Then make a change and quit *without* saving (`:q!`). The preview goes back to the saved file: it shows what is on disk once no editor holds the page.

## 14. On a phone

Make the browser window narrow, about phone width.

**Should happen:** nothing scrolls sideways, the gallery still fits, and the dark band still runs edge to edge.

## Afterwards

- **Stop the play server with Ctrl-C.** The last line says how many calls went to Jev this session, how many failed, and their average time.

- **Any line you liked or didn't:** the words, what it became, and what you expected. The `── Jev` block for it shows why.
- **Your own words:** try saying the same thing differently from these steps ("a quote, really big, in the middle", "shade the next bit", "hide the rest"). The misses are what tunes the catalog's descriptions.
- **Every part in every setting**, for comparison:

  ```sh
  hugo server -s catalogs/blog/page --port 1417
  ```

  Then open http://localhost:1417/paper/.
- `testing/pages/posts/blog.md` has the same parts as ready-made scenes, if you want to look at them all at once.
