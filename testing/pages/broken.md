---
title: Things that are wrong
---

Every line below is wrong on purpose. Each should carry one note, and the page should still draw, with the wrong line left as text.

The part's name isn't finished:

::: quot
:::

A setting isn't finished:

::: quote size=
:::

The value isn't one the setting has:

::: quote size=huge
Words.
:::

The part has no such setting:

::: quote flavor=sweet
Words.
:::

The same setting twice:

::: quote size=large size=normal
Words.
:::

A part from the frame, in a page:

::: header
- [Posts](/posts/)
:::

A part that takes nothing inside it, with a closer anyway:

::: divider
:::

A form with nowhere to send:

::: contact-form

A picture that isn't there:

![A missing picture](/images/nothing-here.jpg)

A closer with nothing to close:

:::

This one is right, and should have no note: in a code block, three colons are code.

```markdown
::: a quote inside a code fence
:::
```

A block that is never closed, which has to come last:

::: quote
Words with no end.
