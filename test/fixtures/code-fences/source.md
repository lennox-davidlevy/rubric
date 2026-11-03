---
title: Code fences
note: |
  ::: front matter is not page content
---

```markdown
::: a directive inside a code fence is code
:::
```

~~~
::: tildes fence too
~~~

````markdown
```
::: a longer fence holds a shorter one
```
:::
````

::: callout
A block with code in it:

```
:::
```

The fence's ::: did not close the block.
:::

``` not-a-fence-because `backticks` in the info
::: callout kind=aside
After a line that only looks like a fence.
:::
