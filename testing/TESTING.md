# Live test: the universal catalog and the frame

The playground now runs on the universal catalog: 34 parts for the writing and 18 for the frame around every page, all in Paper. This test has two halves. First you build the frame in `testing/rubric.md`: the header, footer and the rest that every page wears. Then you build a post from a blank page, `testing/pages/posts/everything.md`, with the new parts. Each step says what to type, what should happen, and what to notice. Write what you find in `notes-on-test.md`, numbered by step.

This file is kept up to date as Rubric changes.

Last updated: 2026-11-02, with PaperMod, the first imported theme (part four). After your notes (pricing marks are now an asterisk, step 12): part three tests what came of them. If you already did parts one and two, restart `bun run play` and Neovim, then go straight to part three.

**New since the last test:**

- The playground uses the universal catalog. Every line you wrote before is asked again the first time you open its page, since the old answers belonged to the blog catalog. Expect a burst of Jev calls in the play log on each first open (well under a cent a page).
- `rubric.md` is now a file you write in, with ghost text, completion and notes, like a page. Its `:::` lines choose the frame.
- Accepting a pick on an empty block writes the part's starter body into it: what the part expects, for you to change.
- Notices are colored by kind (tip olive, warning amber, danger brick). Dates read "November 1, 2026". Everything is in American spelling.
- The diagram draws from a copy of Mermaid that ships with Rubric, so it works offline.
- A page can turn frame parts off with `hide: [sidebar, comments]` in its front matter.

## How to read what you see

- **Neovim**: the ghost text after a `:::` line is Jev's pick. `<M-l>` accepts it and pins the line; on an empty block it also writes the starter body. Colored underlines are notes on the line; `<leader>e` shows the message and `K` (in normal mode) explains what the line became.
- **The play terminal**: a `── Jev` block each time a line is sent, ending in `result`. `placed` means it's on the page. `unsettled` means Jev wasn't sure and it's waiting for you.
- **The browser**: follows the buffer about a third of a second after you stop typing. You never need to save for the preview.
- **A `:::` line shown as raw text on the page** means the line isn't placed yet: Jev hasn't answered, wasn't sure, nothing fits, or the part belongs in the other place.

## 0. Set up

1. Stop any old `bun run play` with Ctrl-C, then from the repo root:

   ```sh
   bun run play
   ```

2. Quit Neovim completely and start it again, so it runs the new server and plugin.

3. Open http://localhost:1415/posts/everything/ beside it. It shows the title "Everything in one walk" with the plain header and footer.

## Part one: the frame, in rubric.md

```sh
nvim testing/rubric.md
```

It holds one line about the look. Leave that line alone and write below it.

### 1. A header

Below the first line, leave an empty line, then type `::: ` and the words:

```markdown
::: a nav bar at the top with links
```

**Should happen:**

- The closer appears, as in a page.
- The log shows a `── Jev` block ending `placed ::: header`, and the ghost text shows ` -> header`.
- Press `<M-l>`. The line is pinned, **and the block fills with a starter list of links**:

  ```markdown
  ::: a nav bar at the top with links -> header
  - [Posts](/posts/)
  - [About](/about/)
  :::
  ```

- In the browser, on every page, the plain header becomes the new one, with those links.

Change the links to what you want, for example `- [Everything](/posts/everything/)`. The header follows as you type.

**Notice:** whether the starter body helps or gets in the way.

### 2. The rest of the frame

Add these, one block each, pausing after each line. Accept each with `<M-l>`. The closer adds each block's `:::` as you type.

```markdown
::: breadcrumbs
::: the date, reading time and author under the title
::: a footer with the copyright
::: a search box
::: a dark mode toggle
::: the headings of the page on the side as you scroll
::: previous and next links
::: let readers reply under posts
```

**Should happen**, on http://localhost:1415/posts/everything/:

- Breadcrumbs above the title, the date and reading time under it.
- A search box and a ◐ button in the header. The button switches the whole site to dark and back, and remembers your choice. The search finds posts as you type.
- A footer with links and the copyright.
- Previous and next links, and a "Comments" heading at the end of a post. It says what to set to make comments work, since this site has no email set.
- "On this page" beside the writing, once the post has headings (part two adds some).

On the home page, http://localhost:1415/, the parts that only make sense on a post (date, pager, comments) don't show.

### 3. The wrong place

In `rubric.md`, type:

```markdown
::: quote
A quote does not belong in the frame.
:::
```

**Should happen:** a note on `quote`, "quote goes in a page; rubric.md holds the frame around every page…". It isn't drawn. Delete the block.

Later, in a page, `::: footer` gets the opposite note: "footer is part of the frame around every page: choose it in rubric.md".

**Notice:** typing `::: ` in `rubric.md` completes only frame parts, and in a page only parts for the writing.

## Part two: a post from a blank page

```sh
nvim testing/pages/posts/everything.md
```

The lists below show only each block's opening line; each one is its own block, with a blank line between. When you type the opening line, the closing `:::` is added for you, as in part one. For each one: type the line, pause until the ghost text shows, then accept with `<M-l>`. On an empty block that writes the starter body, which you then replace with your own words. If a line comes back unsure, pick with `<M-n>` / `<M-p>` and `<M-l>`.

### 4. An opening and some writing

```markdown
::: a big opening for the top of the page
```

Accepting writes a title and a line into the block; change them. Then below it, write a paragraph and two `##` sections of your own, so the page has headings.

**Should happen:** the hero, then your writing. "On this page" now lists your two headings beside the writing (on a wide window).

### 5. Parts made of pieces

Try each, accept, and look at the starter body before changing it:

```markdown
::: step by step instructions
::: the history of the walk, year by year
::: our plans and prices, with the middle one highlighted
::: questions and answers that open when clicked
::: tabs for summer and winter routes
::: a grid of features with icons
```

**Should happen:**

- Steps numbered in circles along a line; a timeline with its dates in the accent color.
- Plans side by side; the middle one stands out once there are three `###` plans (the starter has two, so add one).
- An FAQ: each `##` question closed until clicked.
- Tabs that switch with a click or the arrow keys.
- Cards in a grid, three across on a wide window.

**Notice:** whether the `###` and `##` pattern in the starter bodies is clear enough to follow without reading anything else.

### 6. Numbers, code and diagrams

```markdown
::: some big numbers about the walk
::: a bar chart of miles per month
::: a flowchart of the route
::: the formula for the distance
::: the config file with its name on top
```

**Should happen:** big figures side by side; a bar chart drawn from the table in the block (change the numbers and the bars follow); a flowchart drawn after a moment; a formula set as math; a code block with its file name above it (add `file=config.toml` on the pinned line).

### 7. Media and other sites

```markdown
::: the YouTube video of the walk
::: the podcast episode
::: a map of where we met
::: the PDF to download
```

Replace each starter address with a real one: a YouTube link, an `.mp3` address, a map link, `/images/sample.jpg` for the download.

**Should happen:** a video player; an audio player; a link card for the map (an embed address from Google Maps or OpenStreetMap shows the map itself); a download showing the file's kind and size.

### 8. Asking the reader

```markdown
::: what readers say about the walk
::: a newsletter signup
::: a contact form
::: ask them to sign up at the end, on dark
```

**Should happen:** a testimonial with its curly quotes, a signup box, a form with name, email and message, and a dark pitch with a button.

### 9. Hide part of the frame on one page

In the front matter of `everything.md`, add:

```yaml
hide: [comments, pager]
```

**Should happen:** the comments and the pager go, from this page only.

### 10. Dark, and a phone

Press the ◐ button in the header, then make the window phone width.

**Should happen:** everything readable in dark, nothing scrolling sideways, and "On this page" stepping out of the way on a narrow screen.

## Part three: after your notes

Restart `bun run play` and quit and reopen Neovim first: the server and the plugin both changed. Work in `testing/pages/posts/everything.md`.

### 11. The second pass, after a colon

On a pinned line, type ` : ` after the pin and say how it should look. Start from your video:

```markdown
::: a youtube video of my walk -> video : wider than the text
https://youtu.be/QfQzUb7twZI
:::
```

**Should happen:**

- Nothing is sent while you type. After you pause, the log shows a `── Jev … second pass` block: the words, the part they're about (`about video`), three questions, and a `result` line such as `width=wide`.
- The ghost text at the end of the line shows only what changes: ` ⇒ width=wide`.
- `<M-l>` rewrites the pin and keeps your words: `-> video width=wide : wider than the text`. The ghost text goes, since the pin now says it. The video widens.
- Change the words to `: full width` and pause: ` ⇒ width=full`. Then `: as wide as the writing`: ` ⇒ width back to default`, and accepting drops `width=` from the pin.
- `: with a shadow`: no ghost, and a note on the words, "some of this is more than a video can do: its settings are width". Shadows come with the shared look settings, later.

**Then check the calls stay rare:**

- Save, close the file and open it again. Nothing is sent for lines whose `:` words were already there; `K` on one says what the words asked for.
- Type the same words on another video, even differently cased (`Wider than the text.`): no call, the answer is reused.

**Notice:** whether ` ⇒ …` reads clearly as "this is what changes", and whether the words after the colon feel like yours to keep editing.

### 12. A setting with no value for what you asked

```markdown
::: our plans and prices -> pricing : the first and last ones stand out
```

**Should happen:** `featured` can only be none, last or middle. Expect either a note naming those values ("no value clearly matches what this asks of the pricing: featured can be none, last, middle"), or a pick of the nearest; tell me which, since that is Jev's call and it tunes the wording.

Then the other way to say it, in the plans themselves: end a `###` title with a space and an asterisk.

```markdown
### Reader *
```

**Should happen:** any plan whose title ends in ` *` stands out, as many as you mark, and the asterisk itself isn't shown. Compare the two ways on the catalog page (`hugo server -s catalogs/universal/page --port 1418`, then http://localhost:1418/paper/#pricing: the last example marks the first and last plans).

**Notice:** whether the asterisk or the setting feels more natural to you.

### 13. A form with nowhere to send

Your `::: a newsletter signup -> subscribe` block now has a note on it: "subscribe does not work yet: to is not set (where it sends, a form service's address or an email)…". Same for the contact form.

Fix it either way:

- on the line: `-> subscribe to=you@example.com`, or a form service's address;
- or once for the whole site, in `testing/hugo.toml` under `[params.rubric]`: `form = "you@example.com"`. That needs a restart of `bun run play` and Neovim, since the site's settings are read when the server starts.

**Should happen:** the note goes.

### 14. Starter bodies

Start a new timeline, pricing, stats or chart on an empty block.

**Should happen:** the starter shows the shape only: `### When — What happened`, `**The price**`, `**0** what it counts`, `| Label | Value |`. Nothing that could contradict what you asked for, like the year-by-year starter did for "month by month".

## Part four: PaperMod

The first theme imported from an open-source Hugo theme. To compare, the real PaperMod looks like its demo at https://adityatelange.github.io/hugo-PaperMod/.

### 15. Switch the playground to it

In `testing/hugo.toml`, under `[params.rubric]`, change `theme = "paper"` to:

```toml
theme = "papermod"
```

**Should happen:** after a moment, http://localhost:1415/posts/everything/ redraws as PaperMod: white page, near-black writing in your system's own sans, a large bold site name with plain links, `›` between breadcrumbs, dark code blocks, tags as gray pills, previous and next as one gray box with `PREV` / `NEXT`, a small centered footer. The home page lists posts as bordered cards. Nothing you wrote changes: the same `:::` lines, drawn another way. If it doesn't redraw, restart `bun run play`.

**Then:** press ◐ for dark (PaperMod's own near-black gray), and try phone width.

**Notice:** where it looks like PaperMod and where it doesn't. Known differences: "On this page" stays a column beside the writing (PaperMod puts it in a box at the top), the theme switch is ◐ rather than a moon, and social links are words rather than icons.

Change it back to `theme = "paper"` when you're done, or keep it.

## Afterwards

- **Stop the play server with Ctrl-C.** The last line says how many calls went to Jev this session.
- **Any line you liked or didn't:** the words, what it became, and what you expected. The `── Jev` block for it shows why.
- **Your own words:** say things differently from these steps. The misses are what tunes the catalog's descriptions.
- **Every part in every setting**, for comparison:

  ```sh
  hugo server -s catalogs/universal/page --port 1418
  ```

  Then open http://localhost:1418/paper/, and its stress page.
- The checks behind all this: `RUBRIC_CATALOG=universal bun scripts/theme.ts look` draws the catalog, stress and a framed post at three widths, in light and dark, and refuses anything unreadable or overflowing. Pictures in `catalogs/universal/shots/index.html`.



## NEW NOTES by David during the test

for this:

Then the other way to say it, in the plans themselves: end a `###` title with a star.

```markdown
### Reader ★
```

We can't use that, it is a pain to find that symbol on the keyboard... i get what youre trying, but it has to be something someone can type in, or we abandon this functionality
