### RUBRIC

A rubric is the note written in red beside a manuscript's words, saying how they should be set. Write words on a page. Where a part should look a certain way, open a block and say so in your own words. Rubric picks a real part from a catalog that a person designed, fills in its settings, and shows the page as you type. The site's look is picked the same way, from a line at the root.

```markdown
::: a quote from the book, big and centered

Not all those who wander are lost.

:::
```

You write the page. The model never does. Blogs first.

The plan is in [docs/plan.md](docs/plan.md), with where each step stands under "Order of work". Built so far: the core (scanner, preprocessor, validator, cache, resolver), the language server with a Neovim plugin, one catalog of 52 website parts in `catalogs/universal/` with Paper, PaperMod and Blowfish as themes, and a live playground. [docs/lsp.md](docs/lsp.md) has how the server works and what the live tests found; [CLAUDE.md](CLAUDE.md) has the commands.
