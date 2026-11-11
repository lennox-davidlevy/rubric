---
title: Every part
---

Every part for the writing, filled in and written in plain form, so this page never asks Jev. Keep it open while you switch themes.

::: hero image=/images/sample.jpg
# Field Notes

Notes on walking, reading and the slow work of paying attention.
:::

::: lead
I kept a list of every walk I took for a year. The list was less interesting than what it left out.
:::

## Contents

::: contents

## Writing

Plain prose comes first, with **strong words**, *emphasis*, `inline code` and [a link](/posts/). A theme has to get this right before anything else.

::: quote cite="A proverb, source unknown"
The palest ink is better than the best memory.
:::

::: quote size=large align=center
A pull quote, larger than the prose and centered.
:::

::: sidenote
A note in the margin, about the sentence beside it.
:::

The sentence the note above sits beside, which runs long enough for the margin to have something to line up with on a wide screen.

::: callout
A plain note: something worth knowing.
:::

::: callout kind=tip icon=lightbulb title="A good idea"
Advice that makes something easier.
:::

::: callout kind=warning icon=warning
Something that could go wrong.
:::

::: callout kind=danger icon=fire
Something that could cause harm or loss.
:::

::: testimonial photo=/images/gallery/sample-2.jpg
Working with them felt like having a second editor who never got tired of the same paragraph.

— Ruth Okafor, editor at Northfield Press
:::

## Boxes

::: section tone=tint
### A tinted box

A run of writing set apart from the page. A part can go inside it:

::: callout kind=tip
A callout nested in a section.
:::

:::

::: section tone=dark width=full
### A dark band, the full width of the screen

With [a link](#) in it, which has to read on the dark ground.
:::

::: section edge=raised
### A raised box

Lifted off the page with a shadow.
:::

::: columns split=wide-first
The first column, wider than the other. It holds a little more writing so the difference shows.

---

The second column.
:::

::: cards columns=three edge=outlined
### Reservoir

Two miles, mostly flat.

### Canal

Lit as far as the gasworks.

### The long way

Adds a mile and is never a mistake.
:::

## Pictures and sound

::: figure width=wide
![A soft field of color](/images/sample.jpg)

The canal by the gasworks, early on a Sunday.
:::

::: gallery columns=three
![The canal at first light](/images/gallery/sample-1.jpg)
![A gate on the reservoir path](/images/gallery/sample-2.jpg)
![Reeds after rain](/images/gallery/sample-3.jpg)
![The old pumping station](/images/gallery/sample-4.jpg)
![A heron, too far away](/images/gallery/sample-5.jpg)
![The last bus stop](/images/gallery/sample-6.jpg)
:::

::: gallery layout=slideshow
![The canal at first light](/images/gallery/sample-1.jpg)
![A gate on the reservoir path](/images/gallery/sample-2.jpg)
![Reeds after rain](/images/gallery/sample-3.jpg)
:::

::: video
/video/clip.webm

A test pattern, from a file on this site.
:::

::: video
https://www.youtube.com/watch?v=aqz-KE-bpKQ

Big Buck Bunny, from the Blender Foundation, on YouTube.
:::

::: audio
/audio/episode.mp3

Episode 12: six seconds of one note.
:::

::: embed
https://www.openstreetmap.org/export/embed.html?bbox=-0.09,51.50,-0.07,51.51

Something from another site.
:::

::: map zoom=street
51.5055, -0.0754

Where the walk starts, by the river.
:::

::: pdf
/files/route.pdf

The route, to read here.
:::

## Numbers

::: stats
- **2.1** miles from the last stop
- **11** minutes the night bus waits
- **1** man with a cello
:::

::: progress
- Miles walked this year: 72%
- Books read: 40%
- A very long label for something that has to wrap on a phone and still line up: 100%
:::

::: chart
| Month | Visits | Readers |
|-------|-------:|--------:|
| Jan   | 120    | 80      |
| Feb   | 180    | 110     |
| Mar   | 150    | 120     |
| Apr   | 240    | 160     |
:::

::: chart kind=pie
| Where | Miles |
|-------|------:|
| Road  | 2     |
| Canal | 5     |
| Shore | 3     |
:::

::: table lines=striped
| Route | Miles | Weather |
|-------|------:|---------|
| Reservoir | 2.1 | Rain |
| Canal | 1.4 | Clear |
| The long way | 3.6 | Wind |
:::

::: math
\int_0^1 x^2 \, dx = \frac{1}{3}
:::

## Code and structure

::: code file=walk.go
```go
func walk(miles int) string {
	return fmt.Sprintf("%d miles", miles)
}
```
:::

::: file-tree
- pages/
  - posts/
    - first-walk.md
    - walk.md
  - about.md
- rubric.md
- hugo.toml
:::

::: diagram
flowchart LR
  A[Write a line] --> B[Jev picks a part]
  B --> C[Hugo draws the page]
:::

::: tabs
## Summer

Take the canal, and leave after seven.

## Winter

Take the road. The canal floods.
:::

::: fold open=first
## How long is the walk?

About two miles from the last bus stop, most of it along the reservoir.

## Is it safe after dark?

The canal path is lit as far as the gasworks. After that, bring a flashlight.
:::

::: steps
### Catch the last bus

It leaves at ten past nine.

### Get off at the gasworks

It doesn't go any farther.

### Walk

You know the way.
:::

::: timeline
### April — The bus stops running

Nobody tells anyone.

### May — The first walk

Two miles, by accident.

### June — On purpose

The bus times go in a drawer.
:::

## For a landing page

::: pricing featured=middle
### Reader

**Free**

- Every post
- The newsletter

[Start reading](#)

### Supporter

**$5 a month**

- Everything for readers
- Early drafts

[Become a supporter](#)

### Patron

**$20 a month**

- Everything for supporters
- A signed copy

[Become a patron](#)
:::

::: people
- ![Ruth Okafor](/images/gallery/sample-1.jpg) **Ruth Okafor**, editor
- ![Sam Lee](/images/gallery/sample-2.jpg) **Sam Lee**, designer
- ![Ana Ruiz](/images/gallery/sample-3.jpg) **Ana Ruiz**, writer
:::

::: logos
![North](/images/logos/north.svg)
![Harbor](/images/logos/harbor.svg)
![Fieldwork](/images/logos/fieldwork.svg)
:::

::: call-to-action tone=accent
## Walk it with us

Every first Sunday of the month, from the gasworks.

[Sign up](#)
:::

::: buttons align=center
[Read the latest post](/posts/) [About this blog](/about/)
:::

::: download
[The route, for a GPS](/files/route.gpx)

The whole walk, as a track.
:::

::: subscribe to=https://example.com/subscribe
Get new posts by email.
:::

::: contact-form to=https://example.com/form

## The latest posts

::: post-list count=2

::: post-list style=cards tag=water

::: divider style=ornament

## How any part can look

The same four look settings on any part.

::: quote shadow=soft border=outlined corners=round
A soft shadow, a thin line and round corners.
:::

::: figure shadow=deep corners=square
![A soft field of color](/images/sample.jpg)

A strong shadow and square corners.
:::

::: callout text=bigger border=outlined
Bigger writing, in a thin line.
:::

::: lead text=smaller
A lead set smaller than a lead usually is.
:::
