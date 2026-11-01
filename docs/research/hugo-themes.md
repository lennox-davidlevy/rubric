# What 637 Hugo themes are made of

Research for the universal catalog, 2026-11-01. Every theme listed on themes.gohugo.io (`gohugoio/hugoThemesSiteBuilder`, `themes.txt`), fetched by `scripts/themes-fetch.ts` into `reference/hugo-themes/` (layouts, metadata and licenses only), with stars from `scripts/themes-stars.ts`, counted by `scripts/themes-count.ts`. The full tables, with every raw name and the settings each shortcode reads, are in `reference/hugo-themes/report.md`.

A component counts once per theme, under any of its names (`alert`, `callout`, `notice`, `admonition` and the rest are one callout). The grouping is in `themes-count.ts`.

## What it says

- **The vocabulary is small.** Only 299 of 637 themes have any shortcodes, and about 30 block components cover nearly all of them. The long tail is embeds for particular services (bilibili, gist, music players), not design.
- **The frame is universal.** Almost every theme has a header and a footer. About a third have pagination; about a sixth have a sidebar, a table of contents, breadcrumbs or search.
- **Settings are few and plain.** A callout reads a type, a title and an icon; tabs read a title; a button reads a link, an icon and a size. That matches the catalog's handful of plain settings.
- **Inline, Jev chooses among about 30, not 150.** Frame pieces are chosen in `rubric.md`, from their own list of about 20.
- **Licenses:** MIT 500, NOASSERTION 38, GPL-3.0 28, unknown 24, Apache-2.0 24, GPL-2.0 10, MPL-2.0 3, CC-BY-4.0 2. GPL and AGPL themes (including Stack) are left out of importing; the unasserted ones need checking by hand.
- **Kinds of site, by tag:** blog 450, portfolio 88, docs about 60, company 41, landing about 40, resume 19.

## Blocks: themes with one

| component | themes |
|---|---:|
| figure / image | 110 |
| callout | 85 |
| video embed | 71 |
| code / include file | 61 |
| collapsible / accordion / faq | 53 |
| diagram / math / chart | 52 |
| tabs | 40 |
| button / call to action | 36 |
| columns / grid | 36 |
| gallery / carousel | 35 |
| icon | 26 |
| badge / label | 23 |
| quote | 23 |
| audio / music | 23 |
| table of contents | 22 |
| card(s) | 17 |
| hero / lead | 14 |
| post list / series | 14 |
| contact / form | 11 |
| steps | 10 |
| table | 10 |
| map | 10 |
| keyboard / abbr / mark (inline) | 10 |
| timeline | 10 |
| typing / animated text | 9 |
| social / share embeds | 8 |
| divider / spacer | 7 |
| sidenote / footnote | 6 |
| progress | 4 |

## Frame: themes with one

| component | themes |
|---|---:|
| footer | 570 |
| header / nav bar / menu | 551 |
| pagination / prev-next | 246 |
| comments | 160 |
| post meta / date / reading time | 145 |
| tags / categories / tag cloud | 143 |
| post cards / post list | 117 |
| sidebar | 115 |
| table of contents | 109 |
| social links / icons | 108 |
| author / profile / bio | 106 |
| hero / cover / banner | 95 |
| breadcrumbs | 72 |
| search | 71 |
| related posts | 50 |
| share buttons | 50 |
| language switcher | 48 |
| logo / brand | 38 |
| contact | 34 |
| theme switch (dark mode) | 24 |
| archive | 20 |

## The component-rich themes, by shortcode count (8 or more, among the 40 most starred)

| theme | stars | license | shortcodes |
|---|---:|---|---:|
| github.com/nunocoracao/blowfish/v2 | 2929 | MIT | 47 |
| github.com/imfing/hextra | 2404 | MIT | 33 |
| github.com/hugo-fixit/FixIt | 1122 | MIT | 32 |
| github.com/HEIGE-PCloud/DoIt | 940 | MIT | 23 |
| github.com/google/docsy | 2976 | Apache-2.0 | 21 |
| github.com/HugoBlox/hugo-blox-builder/modules/blox-tailwind | 9781 | MIT | 19 |
| github.com/halogenica/beautifulhugo/v5 | 1237 | NOASSERTION | 18 |
| github.com/alex-shpak/hugo-book | 4097 | MIT | 17 |
| github.com/zzossig/hugo-theme-zzo | 738 | MIT | 17 |
| github.com/dillonzq/LoveIt | 3869 | MIT | 16 |
| github.com/jpanther/congo/v2 | 1657 | MIT | 12 |
| github.com/hugo-toha/toha/v4 | 1250 | MIT | 11 |
| github.com/xianmin/hugo-theme-jane | 969 | MIT | 11 |
| github.com/kakawait/hugo-tranquilpeak-theme | 938 | GPL-3.0 | 10 |
| github.com/zhaohuabing/hugo-theme-cleanwhite | 827 | Apache-2.0 | 9 |
| github.com/adityatelange/hugo-PaperMod | 14024 | MIT | 8 |
| github.com/joshed-io/reveal-hugo | 747 | MIT | 8 |

Some well-known themes show few or none because their components come from separate modules they import: Doks (Thulite), Hugoplate (gethugothemes modules), HugoBlox (blocks).
