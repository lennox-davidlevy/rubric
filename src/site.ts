// A Rubric site on disk: a folder with rubric.md at its root, the writer's
// pages in pages/, Hugo's content/ written from them, and Rubric's own state
// in .rubric/.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadCatalog, type Catalog, type PageKind } from "./core/index.ts";

export interface Site {
  root: string;
  pages: string;
  content: string;
  cache: string;
  // Where Hugo serves files from at the site's root: the site's static/ first,
  // then the theme's. /images/walk.jpg is static/images/walk.jpg in either.
  static: string[];
  catalog: Catalog;
}

export async function openSite(root: string): Promise<Site> {
  // The slice has one catalog, read from the theme the site's hugo.toml names.
  const config = await readFile(join(root, "hugo.toml"), "utf8");
  const theme = /^theme\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  const themesDir = /^themesDir\s*=\s*"([^"]+)"/m.exec(config)?.[1] ?? "themes";
  if (!theme) throw new Error(`${root}/hugo.toml names no theme`);
  const themeDir = resolve(root, themesDir, theme);
  return {
    root,
    pages: join(root, "pages"),
    content: join(root, "content"),
    cache: join(root, ".rubric/cache.json"),
    static: [join(root, "static"), join(themeDir, "static")],
    catalog: await loadCatalog(join(themeDir, "catalog.yaml")),
  };
}

// The nearest folder at or above `path` that holds rubric.md.
export function findSiteRoot(path: string): string | undefined {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "rubric.md"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

// A page's path inside pages/, or undefined when the file is not a page.
export function pagePath(site: Site, file: string): string | undefined {
  const rel = relative(site.pages, file);
  return rel.startsWith("..") || !rel.endsWith(".md") ? undefined : rel;
}

export function pageKind(rel: string): PageKind {
  if (rel === "_index.md") return "home";
  return rel.split(sep)[0] === "posts" ? "post" : "page";
}
