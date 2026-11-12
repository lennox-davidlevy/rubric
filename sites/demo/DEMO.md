# Demo: a site from nothing

An empty site for showing Rubric to someone: `rubric.md` is empty and there is one post with only a title. About ten minutes. Three steps draft a new part with your Claude plan (about $0.15 each on Opus at low effort).

## Before they sit down

| | Do | Why |
|---|---|---|
| 1 | Stop any running `bun run play`, then from the repo root: `bun run play sites/demo` | Serves this site at http://localhost:1415 and prints each call to Jev. |
| 2 | Browser on the left at http://localhost:1415/posts/first/, terminal on the right | They watch the page while you type. |
| 3 | `nvim sites/demo/rubric.md`, then `:Rubric model`, **opus**, **low** | The drafter that is both quick and good. The choice is kept. |
| 4 | Font size up in both windows | |

`<M-l>` is the accept key throughout.

## The demo

| # | Say | Do | They see |
|---|---|---|---|
| 1 | "This is the whole site: an empty file and an empty post. No template, no CSS." | Show `rubric.md` and the plain page. | A bare page with a title. |
| 2 | "I choose a look by looking." | In `rubric.md` type `::: theme`, press `<M-l>`, move through the list, Enter on one. | Each theme's picture in the list, and the page changing as you move. |
| 3 | "The frame of every page is a few lines." | Under it type `::: header`, then `- [Posts](/posts/)` and `- [About](/about/)` inside the block. Then `::: a footer with my name and the year`, pause, `<M-l>`. | A header appears. The footer line shows what Jev picked as ghost text, then becomes the part. |
| 4 | "Now I write. When I want something, I say it in my own words." | `nvim sites/demo/pages/posts/first.md`. Write a sentence. Then `::: a quote from my grandmother`, pause, `<M-l>`, and type the quote inside. | Ghost text `-> quote`, then a styled quote on the page as you type. |
| 5 | "It reads what I mean, not keywords." | `::: the three things I learned, in order`, pause, `<M-l>`. On the empty block's `:::`, `<M-l>` again. | A steps part; its starter text fills in for you to overwrite. |
| 6 | "I can adjust a part the same way." | On the quote's line add ` : larger, and centered`, pause, `<M-l>`. | The words become settings on the line, and the quote changes. |
| 7 | "A small, fast model does all of that: it only chooses among parts a designer made. It answers in a fifth of a second and costs almost nothing." | Point at the terminal running `bun run play`. | Each call with its milliseconds and probabilities. |
| 8 | "Here is the part I like. What if no designer made the thing I want?" | `::: a paper airplane that flies across the top of a heading and leaves a dashed trail`, pause. | Ghost text `-> draft a new part`. |
| 9 | "Now a large model writes one, in my theme's colors and type. I keep writing." | `<M-l>`, **Draft**. Write a paragraph below while the spinner runs. | About 20 s later the airplane flies across the page. The line lists its settings. |
| 10 | "I can direct it." | `<M-l>`, **Reroll…**, **Reroll with changes…**, **Notes**: `make the plane bigger and loop once`, Back, then the first entry. | A second take. `<M-p>` and `<M-n>` flip between takes on the page. |
| 11 | "When I like it, it is mine." | `<M-l>`, **Keep**, **This site**. Then `ls sites/demo/parts/` in a shell. | The line becomes `::: paper-plane` (or its name). Three small files: plain HTML and CSS. |
| 12 | "And now the small model knows it. Next time is instant and free." | On a new line: `::: that airplane heading again`, pause. | Jev offers your new part in a fifth of a second, with no draft. |
| 13 | "It follows the theme, because it was drawn with the theme's slots, not its own colors." | Back in `rubric.md`, `<M-l>` on the theme line, move through a few themes. | The airplane, the quote and the header all change together. |
| 14 | "With a picture of my own." | `::: new: a round picture frame with little horses galloping around it, and a caption underneath`, `<M-l>`, **Draft**. When ready, put `![A sample](/images/sample.jpg)` and a caption inside the block. | Horses circle the picture. |
| 15 | "Before it drafts, it shows what I already have." | `::: new: a paper bird gliding over the title`, `<M-l>`. | **Similar: paper-plane** at the top of the menu; choosing it previews your part on the page with no draft. |

## The idea, in three lines

- Writing stays writing: Markdown, your own words, no template language to learn.
- A small model chooses among designed parts, so the common case is instant, cheap and always well made.
- A large model is called only when something is missing, and what it makes joins the catalog, so each new part is paid for once and the site gets richer as it is used.

## If something goes another way

| It happens | Do |
|---|---|
| Jev picks a different part than the table says | `<M-n>` shows the runner-up. Say that it is a judgment, and show the probabilities in the terminal. |
| A draft fails its checks | It is sent back once by itself. If it still fails, `<M-l>`, **Retry**. |
| A draft is poor | **Reroll**, or reroll with Opus at medium through **Reroll with changes…**, **Drafter**. |
| Step 15 shows no Similar entry | The words were too far from the part. Use `::: new: a paper airplane over a heading`. |

## Reset to empty

```sh
git restore sites/demo && git clean -fdx sites/demo
```

That removes every part you kept, the drafts, the cache and the built pages, and puts `rubric.md` and the post back to empty. Restart Neovim and `bun run play sites/demo` afterwards.
