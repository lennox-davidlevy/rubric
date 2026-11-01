The hard cases, drawn in each theme: what a writer will one day type, at its worst. `bun scripts/theme.ts look` draws this page at three widths, checks that nothing scrolls sideways and that every piece of writing can be read against what is behind it, and saves a picture of each.

A long address in the middle of a sentence, https://example.com/notes/2026/the-walk-home/a-very-long-address-with-no-spaces-in-it-at-all, and a long word, Donaudampfschifffahrtsgesellschaftskapitän, must both wrap rather than push the page wider than the screen.

Every kind of text in one paragraph: **strong**, *emphasis*, ***both***, `inline code`, a [link](#), <mark>a highlight</mark>, <abbr title="HyperText Markup Language">HTML</abbr>, <kbd>Ctrl</kbd>+<kbd>C</kbd>, H<sub>2</sub>O, x<sup>2</sup>, figures 1234567890 in the writing, and a footnote.[^note]

## A heading long enough to wrap onto a second line on a phone, and maybe on a laptop too

Writing straight after a heading.

### A third-level heading

#### A fourth-level heading

1. An ordered list that runs past nine items,
2. so the two-digit markers have to hang in the margin too.
3. Three
4. Four
5. Five
6. Six
7. Seven
8. Eight
9. Nine
10. Ten, with a nested list:
    - one
    - two, with a sentence long enough to wrap, so the second line lines up under the first and not under the marker.

> A plain Markdown quote, not a part.
>
> With a second paragraph.

```go
// A comment, in the muted color.
func walk(miles int) string {
	return fmt.Sprintf("%d miles, and a line long enough that it has to scroll inside its own box rather than widen the page", miles)
}
```

| Date | Route | Miles | Weather | Notes |
|------|-------|------:|---------|-------|
| Jan 2, 2026 | Reservoir, canal | 2.1 | Rain | The lower path flooded at the gate |
| Feb 14, 2026 | Canal only | 1.4 | Clear | Herons |
| Mar 30, 2026 | Reservoir, canal, the long way past the gasworks | 3.6 | Wind | — |

---

{{< hero >}}
# A hero with no picture and a title long enough to wrap

The line under it, which also runs on.
{{< /hero >}}

{{< quote size="large" cite="Someone with a long name, in a book with a long title, 1987" >}}
A large quote long enough to run onto three or four lines, so the hanging marks and the balance of the lines can be seen.
{{< /quote >}}

{{< quote align="center" cite="A proverb" >}}
A centered quote at normal size.
{{< /quote >}}

{{< callout kind="note" >}}
A note with a list in it:

- one, with `code`
- two, with a [link](#)
{{< /callout >}}

{{< callout kind="warning" >}}
A warning, with **strong** writing and a [link](#).
{{< /callout >}}

{{< callout kind="tip" >}}
A tip.
{{< /callout >}}

{{< buttons align="center" >}}
[A button with a label long enough to wrap on a phone](#) [Short](#)
{{< /buttons >}}

{{< section tone="dark" width="full" >}}
## Everything inside a dark band

Writing with a [link](#), **strong**, `code` and a footnote-free aside.

{{< quote size="large" cite="Inside the band" >}}
A large quote on the dark ground.
{{< /quote >}}

{{< callout kind="warning" >}}
A warning inside the band, with a [link](#).
{{< /callout >}}

{{< callout kind="note" >}}
A note inside the band.
{{< /callout >}}

{{< divider style="ornament" >}}
{{< /divider >}}

{{< buttons >}}
[Filled](#) [Outlined](#)
{{< /buttons >}}

```js
// Code on the dark ground.
const miles = 2; // and a string: "two"
```
{{< /section >}}

{{< section tone="tint" width="wide" edge="raised" >}}
A wide, tinted, raised box, with a [link](#) and a caption-colored aside in a quote:

{{< quote cite="The tint" >}}
Muted writing on the tint.
{{< /quote >}}
{{< /section >}}

{{< section edge="raised" >}}
A raised box at the width of the writing.
{{< /section >}}

{{< section edge="outlined" >}}
An outlined box.
{{< /section >}}

{{< fold summary="A fold whose summary is long enough to wrap onto a second line on a phone" >}}
What was folded away.
{{< /fold >}}

{{< figure width="full" >}}
![A picture edge to edge](/images/sample.jpg)

A caption under a full-width picture, long enough to wrap onto a second line.
{{< /figure >}}

{{< gallery >}}
![A gallery of one picture](/images/gallery/sample-1.jpg)
{{< /gallery >}}

{{< post-list style="cards" >}}
{{< /post-list >}}

{{< post-list style="dated" >}}
{{< /post-list >}}

[^note]: A footnote, smaller, with a [link](#) back.
