---
title: How to undo almost anything in git
---

Every week someone at work asks me how to undo something in git. This is the page I wish I could send them.

Before anything else: if you are not sure what you are doing, make a copy of the whole folder first. It costs nothing and it has saved me more than once.

## Undo your last commit, but keep the changes

```sh
git reset --soft HEAD~1
```

Your files stay exactly as they were. Only the commit goes away, and the changes are staged again.

## Throw away changes to one file

```sh
git restore path/to/file
```

This cannot be undone. Whatever you had in that file since the last commit is gone.

## Find a commit you thought you lost

```sh
git reflog
```

Git remembers everywhere HEAD has been for about ninety days, even after a reset. Find the line you want and check it out.

A few terms that come up:

- **HEAD**: the commit you have checked out right now.
- **Staged**: changes marked to go into the next commit.
- **Reflog**: git's private diary of where HEAD has been.

| Situation | Command |
| --- | --- |
| Undo last commit, keep changes | `git reset --soft HEAD~1` |
| Discard one file's changes | `git restore <file>` |
| Find a lost commit | `git reflog` |

That covers ninety percent of the panicked messages I get.
