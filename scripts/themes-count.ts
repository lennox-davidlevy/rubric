// Counts what the themes in reference/hugo-themes/ are made of: their
// shortcodes (blocks a writer places), the settings each takes, and their
// partials (the frame: nav, sidebar, breadcrumbs). Counted per theme, so one
// theme with ten alert variants counts once, and weighted by stars as well.
//
//   bun scripts/themes-count.ts      writes reference/hugo-themes/count.json and report.md

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parse as toml } from "smol-toml";

const root = join(import.meta.dir, "../reference/hugo-themes");
type T = { path: string; dir: string; sub: string; url: string; stars?: number; license?: string };
const themes = (JSON.parse(readFileSync(join(root, "themes.json"), "utf8")) as T[]).filter((t) => existsSync(t.dir));

const walk = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

// One name for the many spellings of a thing: "Alert-Box.html" and
// "alert_box" are the same shortcode.
const norm = (name: string) => name.toLowerCase().replace(/\.(html|md|xml|json)$/, "").replace(/[-_ ]+/g, "-");

type Tally = { themes: Set<string>; stars: number; params: Map<string, number>; examples: string[] };
const tally = () => new Map<string, Tally>();
const add = (m: Map<string, Tally>, name: string, t: T, params: string[] = []) => {
  let e = m.get(name);
  if (!e) m.set(name, (e = { themes: new Set(), stars: 0, params: new Map(), examples: [] }));
  if (e.themes.has(t.path)) return;
  e.themes.add(t.path);
  e.stars += t.stars ?? 0;
  for (const p of new Set(params)) e.params.set(p, (e.params.get(p) ?? 0) + 1);
  if (e.examples.length < 4) e.examples.push(t.path);
};

// The same component under its many names. A theme counts once per
// component however many of the names it has. Judgment, from reading the
// raw lists below; a name not here is left out of the grouped counts.
const BLOCKS: Record<string, string[]> = {
  callout: ["alert", "callout", "notice", "note", "admonition", "hint", "tip", "warning", "info", "danger", "important", "caution", "attention", "aside", "message", "notification"],
  "figure / image": ["figure", "image", "img", "fig", "picture", "intextimg", "screenshot", "svg", "imgproc", "img-lazy"],
  "tabs": ["tab", "tabs", "tabgroup", "tabpane", "tab-pane", "tabbed"],
  "collapsible / accordion / faq": ["details", "collapse", "expand", "accordion", "accordion-item", "spoiler", "faq", "toggle"],
  "video embed": ["video", "youtube", "vimeo", "bilibili", "iframe", "asciinema", "youtubelite", "peertube"],
  "diagram / math / chart": ["mermaid", "katex", "math", "echarts", "chart", "plantuml", "graphviz", "mathjax", "latex"],
  "button / call to action": ["button", "cta", "btn", "link-button", "buttons"],
  "gallery / carousel": ["gallery", "carousel", "slide", "slider", "slideshow", "swiper", "lightbox"],
  "columns / grid": ["columns", "column", "grid", "row", "col", "feature-grid", "center", "flex", "two-column", "split"],
  "card(s)": ["card", "cards", "card-grid", "linkcard", "link-card", "article"],
  "code / include file": ["code", "highlight", "include", "readfile", "file", "codeblock", "code-block", "gist", "github", "gitlab", "codepen"],
  "icon": ["icon", "fa", "fontawesome", "emoji", "svg-icon"],
  "badge / label": ["badge", "label", "tag", "pill", "chip", "keyword"],
  "quote": ["quote", "blockquote", "pullquote", "pull-quote", "epigraph", "testimonial"],
  "table of contents": ["toc", "contents", "table-of-contents"],
  "audio / music": ["audio", "music", "podcast", "spotify", "soundcloud"],
  "timeline": ["timeline", "timeline-item"],
  "steps": ["steps", "step"],
  "hero / lead": ["hero", "lead", "banner", "jumbotron", "intro"],
  "table": ["table", "datatable", "csv-table"],
  "post list / series": ["recent-posts", "list", "series", "posts", "articles", "children", "pagelist", "list-pages"],
  "progress": ["progress", "progressbar", "skill"],
  "map": ["mapbox", "map", "openstreetmap", "leaflet", "googlemaps"],
  "keyboard / abbr / mark (inline)": ["kbd", "abbr", "mark", "highlight-text", "sup", "sub"],
  "sidenote / footnote": ["sidenote", "marginnote", "footnote"],
  "contact / form": ["contact", "form", "contact-form", "newsletter", "subscribe"],
  "social / share embeds": ["tweet", "twitter", "x", "instagram", "mastodon", "bluesky"],
  "typing / animated text": ["typeit", "typed", "typewriter"],
  "divider / spacer": ["divider", "spacer", "hr", "separator", "br"],
};
const FRAME: Record<string, string[]> = {
  "header / nav bar / menu": ["header", "nav", "navbar", "menu", "navigation", "site-header", "topbar", "top-bar", "main-menu", "masthead"],
  "footer": ["footer", "site-footer", "foot", "copyright"],
  "pagination / prev-next": ["pagination", "pager", "paginator", "prev-next", "post-nav", "page-nav", "next-prev", "post-navigation"],
  "sidebar": ["sidebar", "aside", "side-bar", "sidenav", "side-nav", "left-sidebar", "right-sidebar"],
  "table of contents": ["toc", "table-of-contents"],
  "comments": ["comments", "comment", "disqus", "giscus", "utterances", "commento", "remark42", "isso", "cusdis", "waline", "twikoo"],
  "social links / icons": ["social", "social-icons", "social-links", "socials", "social-media"],
  "tags / categories / tag cloud": ["tags", "terms", "categories", "tag-cloud", "taxonomy", "tag"],
  "search": ["search", "search-form", "search-bar", "pagefind", "algolia", "fuse"],
  "author / profile / bio": ["author", "profile", "bio", "about", "author-bio", "avatar"],
  "post meta / date / reading time": ["post-meta", "date", "meta", "metadata", "reading-time", "post-info", "byline"],
  "share buttons": ["share", "share-buttons", "sharing", "social-share"],
  "breadcrumbs": ["breadcrumbs", "breadcrumb"],
  "related posts": ["related", "related-posts", "related-content", "similar"],
  "hero / cover / banner": ["hero", "cover", "banner", "page-header", "jumbotron", "header-image"],
  "post cards / post list": ["post-card", "post-list", "card", "summary", "item", "list-item", "article-list", "recent-posts", "posts"],
  "language switcher": ["language-switcher", "translations", "languages", "i18nlist", "lang-switch", "language-selector"],
  "theme switch (dark mode)": ["theme-switch", "theme-toggle", "darkmode", "dark-mode", "theme-switcher", "toggle-theme", "color-scheme", "dark-mode-toggle"],
  "logo / brand": ["logo", "brand", "site-title", "site-logo"],
  "archive": ["archive", "archives"],
  "contact": ["contact", "contact-form"],
};
const shortcodes = tally(), partials = tally(), blocks = tally(), frame = tally();
const groupOf = (groups: Record<string, string[]>, name: string) => Object.entries(groups).find(([, names]) => names.includes(name))?.[0];
const tags = new Map<string, number>(), features = new Map<string, number>(), licenses = new Map<string, number>();
const sizes: number[] = [];

// A theme's layouts sit at its root, in the module folder it names, or, for
// a few (Docsy), one folder down; never the demo site's.
const layoutsOf = (t: T) => {
  const base = t.sub ? join(t.dir, t.sub) : t.dir;
  if (existsSync(join(base, "layouts"))) return { base, layouts: join(base, "layouts") };
  const found = walk(t.dir).filter((f) => /\/layouts\//.test(f) && !/exampleSite|\/docs?\/|\/site\/|\/tests?\//i.test(relative(t.dir, f)))
    .map((f) => f.slice(0, f.indexOf("/layouts/") + "/layouts".length)).sort((a, b) => a.length - b.length)[0];
  return found ? { base: join(found, ".."), layouts: found } : { base, layouts: join(base, "layouts") };
};

for (const t of themes) {
  const { base, layouts } = layoutsOf(t);
  const files = walk(layouts).map((f) => relative(layouts, f));
  let count = 0;
  for (const f of files) {
    const m = /^_?shortcodes\/(.+)$/.exec(f);
    if (m) {
      const src = readFileSync(join(layouts, f), "utf8");
      // The settings it reads: .Get "name", and .Get 0 for positional ones.
      const params = [...src.matchAll(/\.Get\s+"([A-Za-z0-9_-]+)"/g)].map((x) => x[1]!.toLowerCase());
      if (/\.Get\s+\d/.test(src)) params.push("(positional)");
      if (/\.Inner/.test(src)) params.push("(inner)");
      const n = norm(m[1]!.split("/").pop()!);
      add(shortcodes, n, t, params);
      const g = groupOf(BLOCKS, n);
      if (g) add(blocks, g, t);
      count++;
    }
    const p = /^_?partials\/(.+)$/.exec(f);
    if (p) {
      const n = norm(basename(p[1]!));
      add(partials, n, t);
      const g = groupOf(FRAME, n);
      if (g) add(frame, g, t);
    }
  }
  sizes.push(count);
  const tt = join(base, "theme.toml");
  if (existsSync(tt)) {
    try {
      const meta = toml(readFileSync(tt, "utf8")) as { tags?: string[]; features?: string[]; license?: string };
      for (const x of meta.tags ?? []) tags.set(x.toLowerCase(), (tags.get(x.toLowerCase()) ?? 0) + 1);
      for (const x of meta.features ?? []) features.set(x.toLowerCase(), (features.get(x.toLowerCase()) ?? 0) + 1);
    } catch {}
  }
  const lic = t.license ?? "unknown";
  licenses.set(lic, (licenses.get(lic) ?? 0) + 1);
}

const ranked = (m: Map<string, Tally>, min = 3) =>
  [...m.entries()].filter(([, e]) => e.themes.size >= min).sort((a, b) => b[1].themes.size - a[1].themes.size).map(([name, e]) => ({
    name, themes: e.themes.size, stars: e.stars,
    params: [...e.params.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${p}:${n}`),
    examples: e.examples,
  }));
const top = (m: Map<string, number>, n = 40) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const result = {
  themes: themes.length,
  withShortcodes: sizes.filter((n) => n > 0).length,
  blocks: ranked(blocks, 1),
  frame: ranked(frame, 1),
  shortcodes: ranked(shortcodes),
  partials: ranked(partials, 10),
  tags: top(tags), features: top(features), licenses: top(licenses, 20),
  byStars: themes.filter((t) => t.stars !== undefined).sort((a, b) => b.stars! - a.stars!).slice(0, 40).map((t) => ({ path: t.path, stars: t.stars, license: t.license, shortcodes: walk(layoutsOf(t).layouts).filter((f) => /\/_?shortcodes\//.test(f)).length })),
};
writeFileSync(join(root, "count.json"), JSON.stringify(result, null, 2));

const row = (r: (typeof result.shortcodes)[number]) => `| ${r.name} | ${r.themes} | ${r.stars} | ${r.params.join(", ")} |`;
writeFileSync(join(root, "report.md"), [
  `# What ${result.themes} Hugo themes are made of`, "",
  `${result.withShortcodes} of them have shortcodes.`, "",
  "## Blocks, grouped: how many themes have one, under any name", "", "| component | themes | stars |", "|---|---:|---:|",
  ...result.blocks.map((r) => `| ${r.name} | ${r.themes} | ${r.stars} |`), "",
  "## Frame, grouped: how many themes have one, under any name", "", "| component | themes | stars |", "|---|---:|---:|",
  ...result.frame.map((r) => `| ${r.name} | ${r.themes} | ${r.stars} |`), "",
  "## Shortcodes in 3 or more themes", "", "| name | themes | stars | settings read (themes) |", "|---|---:|---:|---|",
  ...result.shortcodes.map(row), "",
  "## Partials in 10 or more themes", "", "| name | themes | stars |", "|---|---:|---:|",
  ...result.partials.map((r) => `| ${r.name} | ${r.themes} | ${r.stars} |`), "",
  "## Most starred", "", "| theme | stars | license | shortcodes |", "|---|---:|---|---:|",
  ...result.byStars.map((t) => `| ${t.path} | ${t.stars} | ${t.license} | ${t.shortcodes} |`), "",
  "## Tags", "", result.tags.map(([k, v]) => `${k} ${v}`).join(", "), "",
  "## Features", "", result.features.map(([k, v]) => `${k} ${v}`).join(", "), "",
  "## Licenses", "", result.licenses.map(([k, v]) => `${k} ${v}`).join(", "), "",
].join("\n"));
console.log(`${result.themes} themes, ${result.shortcodes.length} shortcodes in 3+ themes, ${result.partials.length} partials in 10+`);
