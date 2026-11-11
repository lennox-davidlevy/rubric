# Live test: everything Rubric does (the whole run)

A whole run on a new site, from an empty frame to a built one. Sections stand alone once the frame is built, so it's fine to stop and pick up later. All of it takes about an hour; section 9 (every part) and section 15 (themes) are the long ones.

Write what you find in the **Notes** section at the bottom, numbered by section.

Last updated: 2026-11-07.

**About the expected picks.** The words below are lines Jev has placed well in past probes, so a miss is worth noting. Lines for the newest parts ran on the current catalog (version 9); most others last ran on version 3, so a few may come back differently. Say which.

**Already known, so no need to note them:**

- With a sidebar or the page contents on, at about 1150 to 1300 px wide, a sidenote collapses to a strip one letter wide. It's fine with no side columns.
- `/fr/about/` draws with no frame, since the frame page exists only in English. Don't open `about.fr.md` in Neovim either: the preview goes to the wrong address.
- With both side columns on, a full-width dark band fills the middle column, not the screen. In a narrow column the featured plan's button wraps tight against its edge.
- `other-skin` can't be reached: no skin adds a part or setting of its own any more.

## The site

| Page | Address | What it's for |
| --- | --- | --- |
| `rubric.md` | around every page | Starts empty. You build the frame in section 2. |
| `pages/posts/walk.md` | `/posts/walk/` | Starts empty. You write here. |
| `pages/parts.md` | `/parts/` | All 39 parts for the writing, filled in, in plain form. Never asks Jev. Keep it open for themes. |
| `pages/broken.md` | `/broken/` | Every mistake a line can make, on purpose. |
| `pages/posts/reservoir.md` | `/posts/reservoir/` | A finished post with a cover and headings. |
| `pages/posts/night-bus.md`, `first-walk.md` | `/posts/…` | Finished posts, for the pager, related posts and search. |
| `pages/about.md`, `about.fr.md` | `/about/`, `/fr/about/` | A page with no date, and a translation for the language switch. |
| `pages/_index.md` | `/` | The home page, with its post list. |

`static/` holds what the parts need: `/images/sample.jpg`, `/images/path.png`, `/images/gallery/sample-1.jpg` to `-6`, `/images/logos/north.svg`, `harbor.svg`, `fieldwork.svg`, `/files/route.pdf`, `/files/route.gpx`, `/audio/episode.mp3`, `/video/clip.webm`.

## 0. Set up

1. Quit Neovim completely, so no old language server is left running.
2. From the repo root:

   ```sh
   bun run play
   ```

   If it says port 1416 is taken, everything else still works, but the page won't follow the cursor.
3. Open http://localhost:1415/ beside Neovim.

After this, nothing needs a restart, not even switching themes.

## 1. No frame yet

Click through `/`, `/posts/`, `/posts/reservoir/`, `/about/`, `/parts/`.

**Should happen:**

- A plain site name at the top and a plain copyright line at the bottom. With no header or footer chosen, the plain ones stay.
- A post shows its date and reading time under the title, and its tags at the end. The cover on `/posts/reservoir/` doesn't show yet.
- `/parts/` draws every part in Paper with no text left as `:::`. Open the gallery, change a tab, open a fold, sort the table by a heading, and play the audio and the video.

## 2. The frame, by words

```sh
nvim testing/rubric.md
```

Type each line and press `<M-l>` twice: once to ask, once to accept. Watch `/posts/reservoir/`, which has something for every part. Parts with a starter body write it for you.

| Line | Expect | Look for |
| --- | --- | --- |
| `::: an announcement strip at the very top` | `banner` | A thin strip above everything |
| `::: a top navigation bar` | `header` | Replaces the plain top; the name and links |
| `::: a search box` | `search` | In the header. Type "cello": the night bus comes up |
| `::: a dark mode toggle` | `theme-switch` | In the header. Flips the page, and remembers after a reload |
| `::: switch between english and french` | `languages` | Only on `/about/`, which has a translation |
| `::: a trail of links back to home` | `breadcrumbs` | Above the title |
| `::: a featured image at the top of each post` | `cover` | The picture across the top |
| `::: the date, reading time and author` | `post-meta shows=everything` | "A. Writer" under the title |
| `::: a sidebar with the sections` | `sidebar` | A column on the left |
| `::: a floating table of contents` | `page-contents` | The headings on the right. Click one, then scroll |
| `::: an about the author box` | `author` | After the post. Change the picture to `/images/gallery/sample-2.jpg` |
| `::: the tags at the end of each post` | `tags` | As links |
| `::: share buttons` | `share` | Email, X, LinkedIn |
| `::: more posts like this one` | `related` | "More like this" |
| `::: previous and next links` | `pager` | The night bus and the first walk |
| `::: a discussion section for each post` | `comments` | "Reply by email" |
| `::: icons linking to my github and mastodon` | `social` | At the bottom, named GitHub and Mastodon |
| `::: a big footer with columns of links` | `footer layout=columns` | Replaces the plain bottom |

**Should happen:**

- Every change shows without a save or a reload.
- `/about/` and `/` have the frame but none of the parts that belong to posts: no details, tags, author, share, related, pager or comments.
- `/about/` offers Français, and it opens. The way back is the browser's: see "Already known".
- At phone width (360 px), the side columns move out of the way and nothing scrolls sideways.

Then the lines that don't belong here:

- `::: a quote from a book` is nothing for the frame. The note says "nothing for the frame fits; rubric.md holds only what goes around every page, and parts for the writing go in a page".
- `::: quote` typed by hand. The note says quote goes in a page.

Delete both, and try changing the header: `::: a menu across the top that stays when scrolling` should give `header sticky=stays`, and the header stays as you scroll.

## 3. The page follows your cursor

Open `testing/pages/posts/reservoir.md` (`:e` is fine). The browser should switch to it by itself.

**Should happen:**

- Move up and down: the page scrolls with you, keeping the block you're on about a third of the way down.
- `:e testing/pages/posts/night-bus.md`: the browser opens it. `:b#` goes back.
- `:e testing/rubric.md`: the browser stays where it is, since the frame isn't a page.

Close the two posts without changing them, and open `testing/pages/posts/walk.md`.

## 4. How fast the ghost text comes

Each of these is a new line in `walk.md`.

| Try | Line | Should happen |
| --- | --- | --- |
| Press `<M-l>` as soon as you finish | `::: a quote from someone famous` | Ghost text about a quarter of a second later. `<M-l>` again accepts |
| Press Esc as soon as you finish | `::: a warning before the next step` | The page shows the pick at once, faded. Go back into insert mode at the end of the line to see the ghost text |
| Just stop typing | `::: a helpful hint` | **New: restart Neovim once to get this.** Ghost text after your pause plus about 0.2 s for Jev: the pause is 0.6 s at first, shorter once you've typed a few lines, never under 0.3 s. Say if it comes too soon, with half-typed words |
| Type it, delete it, type it again | `::: a helpful hint` | Instant, and no new `── Jev` block: it's cached |
| **New: restart Neovim once to get this.** Stop on `::: a big quote` until the ghost text shows, then keep typing ` from a friend` | | The ghost text goes with your first key and nothing you type lands on it. It comes back after your next pause, after the new words. `<M-l>` right after typing asks, and doesn't accept the old pick |

**Should happen:** one `── Jev` block per line in the play terminal. Note any block with half-typed words in it, like "a flowchart of the ro". A line that starts with a part never makes one, even when you edit its body.

## 5. Choosing, and asking why

Delete what's in `walk.md`'s body from section 4.

**A block from nothing.** Type `::: a big opening for the top of the page`.

- The closing `:::` appears below as soon as you type the first space.
- The ghost text shows `-> hero size=tall` with its starter body, and the page shows the hero with its starter text, faded.
- `<M-l>` puts `hero size=tall` in place of the words, writes the starter into the file, and the hero turns solid.

**A block with writing in it.** Write a sentence inside a new `::: a tip for the reader` block before you accept. Accepting changes only the `:::` line, and leaves your sentence alone.

**Two picks.** Type `::: something on the side`.

- If Jev is unsure, a dim `1 of 2 · <M-n> for the next` follows the ghost text. If Jev is sure, there's no hint; say which you got.
- **New: restart Neovim once to get this.** `<M-n>` shows the other pick in the ghost text and on the page, about a third of a second later, faded if the block is empty. `<M-p>` goes back, and both wrap around.
- Esc takes the page back to the first pick, along with the ghost text.
- `<M-l>` on the second pick pins that one, and the page keeps it.

**Not sure.** Type `::: the menu as a pdf`. Last time it was `pdf` or `download`.

- The line stays as text on the page, the note says "not sure what this asks for: pdf or download", and the ghost text offers both.
- `<M-n>` draws the second pick on the page, and `<M-n>` again draws the first. Esc puts the line back to text.

**Nothing fits.** Type `::: a bulleted list of what to bring`.

- No ghost text. The note says "nothing in the catalog fits", and the line shows as text on the page.

**Asking why.** In normal mode, on each of those lines:

- `K` on a line of words: the pick or "not sure", its fit, how every part scored, and the model.
- `K` on an accepted line: the part's description and what each setting means.
- `<leader>e` on a line with a note: the note.

Delete the unsure lines when you're done, or section 11's page will be busy.

## 6. Plain form, without Jev

All on new lines in `walk.md`. Each of these should make no `── Jev` block.

| Type | Should happen |
| --- | --- |
| `::: ` | Completion offers the parts for the writing, each with its description. In `rubric.md` it offers the frame's instead |
| `::: quote ` | Offers `size`, `align`, `cite`, and the look settings `shadow`, `border`, `corners`, `text` |
| `::: quote size=` | Offers `normal` and `large`, with what each means |
| Backspace over `large` | The menu comes back |
| `::: quote size=large cite="My grandmother"` | Draws at once: a value with spaces is quoted |
| `::: hero image=` | Offers the site's pictures |
| `![A picture](/images/` | Offers the site's pictures, on any line |
| `::: a line of words` | Offers nothing: words are for Jev. This one does make a block |
| Inside a code fence, `::: ` | Offers nothing, and the closer isn't a problem |

**New: restart Neovim once to get this.** With spell checking on, `::: a big qoute` gets a squiggle on `qoute`, and on `::: callout icon=lightbulb : make it biggr` only `biggr` does. `::: callout icon=lightbulb` gets none, and neither does a value in quotes. A line of words like `::: a wooden lightbulbb` keeps its squiggle.

## 7. The second pass

```markdown
::: the podcast episode
```

`<M-l>` twice, put `/audio/episode.mp3` on the first line of the body, then add ` : with a hard shadow and a bright border` after `audio` on the `:::` line.

**Should happen:**

- The starter has a caption line, "A line about it, shown with the player."
- Ghost text shows `⇒ shadow=deep border=outlined`, or close to it. `<M-l>` rewrites the settings in the part and drops your words.
- One `── Jev … second pass` block. The part isn't asked again.
- If Jev judges "hard" and "bright" to ask for more than it can give, the note reads "took shadow=deep border=outlined, but some of this asks for more than audio's settings can say. audio offers…". Say what you got.

Then:

- Add ` : no shadow` to the line. Before accepting, `K` says what the words after the colon asked for. Ghost text shows `shadow back to default`, or close to it.

## 8. How any part looks, by words

| Line | Expect |
| --- | --- |
| `::: a small quote in smaller text` | `quote text=smaller` |
| `::: a hero with a thin outline` | `hero border=outlined` |
| `::: a video clip, full width` | `video width=full` |
| `::: a big centered quote from the interview` | `quote size=large align=center` |

**Should happen:** each draws as it says. Then try "big" alone: `::: a big opening paragraph` should be plain `lead`, with no `text=bigger`, since "big" is what picked it. On any pin, ` : with a soft shadow and round corners` should add `shadow=soft corners=round`.

## 9. Every part, by words

The long one. Start a new page if you'd rather: `:e testing/pages/posts/parts-by-words.md` with a title and date in its front matter works with no restart. Type each line, accept it, and check three things: the pick, that the starter shows its shape faded before you accept, and that it draws. Replace the starter where the table says, since it needs a real value to draw.

**Writing**

| Line | Expect | Then |
| --- | --- | --- |
| `::: a splash header for the landing page` | `hero` | |
| `::: an intro paragraph in larger type` | `lead` | |
| `::: a pull quote from the interview` | `quote size=large` | |
| `::: what our customers say about us` | `testimonial` | Add `photo=/images/gallery/sample-2.jpg` to the pin |
| `::: a tip with a lightbulb` | `callout kind=tip icon=lightbulb` | The lightbulb draws |
| `::: a big red danger box about deleting your data` | `callout kind=danger` | |
| `::: a note in the margin about this sentence` | `sidenote` | Needs a paragraph after it, and writing inside |

**Boxes and layout**

| Line | Expect | Then |
| --- | --- | --- |
| `::: a gray box around this paragraph` | `section tone=tint` | Write inside it |
| `::: a black band with the quote in it` | `section tone=dark` | Write inside it |
| `::: two columns side by side` | `columns` | |
| `::: a feature grid` | `cards` | |

**Pictures and sound**

| Line | Expect | Then |
| --- | --- | --- |
| `::: one wide photo with a caption` | `figure width=wide` | Use `/images/sample.jpg` |
| `::: a few photos from the trip` | `gallery` | Use `/images/gallery/sample-1.jpg` to `-3`. Click one |
| `::: a slideshow of the photos` | `gallery layout=slideshow` | The same pictures, with arrows |
| `::: the YouTube video of the talk` | `video` | Use `https://www.youtube.com/watch?v=aqz-KE-bpKQ` |
| `::: an mp3 of the interview` | `audio` | Use `/audio/episode.mp3` |
| `::: my slides from the conference` | `embed` | **New.** Use a real page, like `https://github.com/gohugoio/hugo`: the card shows its picture, title and description, as a shared link does in a chat. It takes a moment the first time and is instant after. A page that gives none, or an address that doesn't exist, shows the plain card |
| `::: a street map of the venue` | `map zoom=street` | Use `51.5055, -0.0754`. Should not pick `embed` |
| `::: a map of the whole city` | `map zoom=city` | The same place, zoomed out |
| `::: let people read the report without downloading it` | `pdf` | **New.** Accepting leaves the placeholder `/files/document.pdf`, now flagged "no file at /files/document.pdf in static/". Change it to `/files/route.pdf`: the PDF shows in place, with no refresh. The link works too |

**Numbers**

| Line | Expect | Then |
| --- | --- | --- |
| `::: some big numbers about the project` | `stats` | |
| `::: bars showing how far along each goal is` | `progress` | Edit a percentage; the bar moves |
| `::: a pie chart of where the money went` | `chart kind=pie` | Edit a number; the slice moves |
| `::: a line graph of my running times` | `chart kind=line` | |
| `::: a striped table` | `table lines=striped` | Fill in a few rows. Click a heading to sort |
| `::: the quadratic formula` | `math` | Use `x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}` |

**Code and structure**

| Line | Expect | Then |
| --- | --- | --- |
| `::: the snippet from utils.py with its filename` | `code` | Jev doesn't fill in the name, so after accepting, add it to the line yourself: `::: code file=utils.py`. Put some code in the fence; `utils.py` shows above it |
| `::: a tree of the files in this repo` | `file-tree` | |
| `::: a flowchart of the signup process` | `diagram` | |
| `::: tabs for mac, windows and linux` | `tabs` | |
| `::: an accordion with the first one open` | `fold open=first` | |
| `::: how to install it in three steps` | `steps` | |
| `::: my career so far, by date` | `timeline` | |
| `::: an index of the sections on this page` | `contents` | Lists this page's headings |

**For a landing page**

| Line | Expect | Then |
| --- | --- | --- |
| `::: three pricing tiers with the middle one highlighted` | `pricing featured=middle` | End a plan's title in ` *` and it stands out too |
| `::: our team members with their roles` | `people` | Use the gallery pictures |
| `::: a row of our partners' logos` | `logos` | Use `/images/logos/north.svg` and the others |
| `::: a final pitch with a sign-up button` | `call-to-action` | |
| `::: two buttons, read more and about, centered` | `buttons align=center` | |
| `::: a downloadable zip of the source` | `download` | Use `[The route](/files/route.gpx)`. Shows GPX and its size |
| `::: the latest posts as cards` | `post-list style=cards` | Add `tag=water` to the pin: only the reservoir |
| `::: a section break` | `divider` | |
| `::: a newsletter signup` | `subscribe` | See section 14 |
| `::: a contact form` | `contact-form` | See section 14 |

## 10. Blocks inside blocks, and code

In `walk.md`:

````markdown
::: section tone=tint
Some writing in a box.

::: callout kind=tip
A callout in the box.
:::

:::

```markdown
::: this is code, not a directive
```
````

**Should happen:**

- The callout draws inside the box, and neither has a note.
- The fenced line stays as code, with no note, no ghost text and no call.
- Typing `::: ` inside the section adds a closer of its own, even though the section's `:::` is right below.

## 11. Nothing reloads

With a video, a diagram and tabs on the page from section 9, start the video playing. Then edit a paragraph, rename a heading, and add a word to a tab.

**Should happen:**

- **The video keeps playing**, the diagram stays the same size, and the page doesn't jump.
- Change a label in the diagram: only the diagram is drawn again.
- The tabs still switch after you edit them, and there's only one row of tab buttons.
- A map or a PDF doesn't reload when your cursor moves off it and back.
- Type quickly for a few seconds, then stop: the page ends on what you typed, never a keystroke behind.

## 12. Mistakes

`:e testing/pages/broken.md`, and walk through the notes with `]d`. The browser opens `/broken/`.

**Should happen:** the page draws, each wrong line stays as text, and each line carries one note:

| Line | Note |
| --- | --- |
| `::: quot` | `unfinished-part`: not a part, and the parts are… |
| `::: quote size=` | `unfinished-setting`: each setting is key=value… |
| `::: quote size=huge` | `value-not-allowed`: allowed: normal, large |
| `::: quote flavor=sweet` | `unknown-setting` |
| `::: quote size=large size=normal` | `duplicate-setting` |
| `::: header` | `wrong-place`: choose it in rubric.md |
| The `:::` under `::: divider` | `stray-closer`: divider takes nothing inside |
| `::: contact-form` | `needs-setting`: where it sends |
| `![A missing picture](/images/nothing-here.jpg)` | `missing-file`: no file at… in static/ |
| A lone `:::` | `stray-closer` |
| The last `::: quote` | `unclosed-block` |
| The fenced `:::` | None |

Fix `size=huge` to `size=large`: its note goes and the quote draws. No line on this page should make a `── Jev` block. Undo with `:e!`.

## 13. Front matter

In `walk.md`'s front matter, type `hide: [comments, pager]` one key at a time.

**Should happen:**

- While it's half typed (`hide: [comm`), the front matter gets a note, "the front matter does not parse yet, so the page shows its last good version", and the page stays as it was.
- **Nothing crashes**: the play terminal keeps going.
- Once the `]` is in, the comments and the pager go from this page and stay on the others.
- Add `cover: /images/path.png`: the cover shows.
- Change the `title`: the page and the post list both follow.

## 14. Forms

On `::: a contact form` and `::: a newsletter signup` from section 9:

**Should happen:**

- Each has a note: "does not work yet: to is not set…".
- `to=https://example.com/form` on one line: that note goes.
- In `testing/hugo.toml`, add `form = "https://example.com/form"` under `[params.rubric]` and save: the other note goes too, with no restart.

Take the line back out afterwards.

## 15. Themes

Keep `/parts/` open, with `pages/parts.md` or `walk.md` in Neovim. In `testing/hugo.toml`, change `theme` under `[params.rubric]` and save, once each. Neovim and play keep running.

**Should happen, every time:** the page restyles in place, with no restart, no new `── Jev` block and no part lost. Look for anything hard to read or broken, here and on `/posts/reservoir/`.

| Theme | What it should look like |
| --- | --- |
| `papermod` | White and near-black, no accent, cards with a border, one tinted pager box |
| `blowfish` | Slate and blue, extra-bold titles, its own callouts and timeline |
| `terminal` | Near-black, amber, monospace, a filled block for the name, dashed lines |
| `bear` | Almost nothing, Verdana, one blue |
| `hyde-teal` | A colored column on the left with a huge name. At phone width, it sits on top |
| `gruvbox-light`, `dracula`, `solarized-dark` | A text-file look, `#` on headings, `[name] $` as the site's name |
| `github` | The code-host look, a tinted bar, thin lines |
| `relearn-blue` | A dark menu on the left, notices with a filled title |
| `hextra` | Hairlines and 8px boxes; a file tree with icons |
| `congo` | Its own callouts |
| `geekdoc` | A deep teal bar, a geometric sans for headings |

**Also:**

- **Light and dark.** On each, flip the switch. A light palette goes to its dark band. A dark palette such as `terminal` moves one step away and never to a light page. Colored columns such as `hyde-teal`'s stay colored.
- **A lost callout.** Back and forth between `blowfish` and `paper` a few times, quickly: the lightbulb callout and the lead stay every time. This was the bug from the third run.
- **New: a lost cover.** Restart every Neovim once to get this. With `walk.md` open in one Neovim and `cover: /images/path.png` added to its front matter but **not saved**, open any other page of the site in a second Neovim. Switch themes a few times: the cover on `/posts/walk/` stays every time. It went before when the other Neovim's server drew `walk.md` from disk.
- **One piece at a time.** Under `theme = "paper"`, add `palette = "dracula"`, then `pairing = "system-sans"`, then `scale = "papermod"`, saving each. Each changes only colors, only fonts, or only sizes. Take them out.
- **All 71, side by side.** `bun scripts/theme.ts look` (about 10 minutes), then open `catalogs/universal/shots/index.html`. It runs in its own browser, so it can wait until the end. I built each of the 71 with this site's full frame, and `/parts/` and `/posts/reservoir/` loaded at 360 and 1280 px with no failed build, script error, missing file or sideways scroll. What's left is taste.

Set it back to `theme = "paper"`.

## 16. When Jev can't be reached

Quit Neovim, then:

```sh
TYPESAFE_API_KEY=bad nvim testing/pages/posts/walk.md
```

Type a line you haven't used: `::: a rotating slider of screenshots`.

**Should happen:**

- The note says "could not reach Jev: HTTP 401…", and `K` says the same.
- The line stays as text, and nothing else on the page changes.
- Every accepted part still draws, and editing one still updates the page.
- Lines you've used before still give ghost text, from the cache.

Quit, and open Neovim normally: the same line resolves.

## 17. With no language server

Quit Neovim, and leave play running. In another terminal:

```sh
bun src/cli.ts watch testing
```

Open `testing/pages/about.md` in `nvim --clean` or any other editor, change a word and save.

**Should happen:** the watch terminal names the page, and `/about/` updates on save. A words line that's already cached draws. One that isn't stays as text, and the terminal says so.

Stop watch and play with Ctrl-C. The last line of play counts the calls to Jev. Then build the site:

```sh
bun src/cli.ts build testing
hugo -s testing --cleanDestinationDir
python3 -m http.server 1417 -d testing/public
```

Open http://localhost:1417/posts/walk/.

**Should happen:**

- The same site, with no faded starters: an empty block is simply empty.
- `grep -c "rubric-live\|rubric-relay" testing/public/posts/walk/index.html` prints 0, so nothing of the live preview is left.
- Only pages that use one load Mermaid. `/about/` has no reference to `mermaid`.

## 18. Afterwards

`bun scripts/pause.ts` replays your typing from `testing/.rubric/keys.jsonl`, and shows the calls, half-typed calls and wait for each pause. If the fitted pause sends more calls than the old one, say so.

To run it all again from an empty site:

```sh
git restore testing/rubric.md testing/hugo.toml testing/pages && git clean -fd testing/pages
```

Answers stay in `testing/.rubric/cache.json`. Delete it to ask Jev again.

## Notes

