// A Rubric site on disk: a folder with rubric.md at its root, the writer's
// pages in pages/, Hugo's content/ written from them, and Rubric's own state
// in .rubric/.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadCatalog, parseSkin, withSkin, type Catalog, type PageKind, type Skin } from "./core/index.ts";

export interface Site {
  root: string;
  pages: string;
  content: string;
  cache: string;
  // Where Hugo serves files from at the site's root: the site's static/ first,
  // then the theme's. /images/walk.jpg is static/images/walk.jpg in either.
  static: string[];
  catalog: Catalog;
  // The skin the site's theme brings, whose additions are in the catalog.
  skin?: string;
  // [params.rubric] in hugo.toml, read once when the site is opened.
  params: Record<string, unknown>;
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
    ...(await skinned(themeDir, rubricParams(config))),
    params: rubricParams(config),
  };
}

// The catalog with the site's skin merged in: the skin of the theme the site
// names under [params.rubric] (themes.yaml), and every other skin known.
async function skinned(themeDir: string, params: Record<string, unknown>): Promise<{ catalog: Catalog; skin?: string }> {
  const base = await loadCatalog(join(themeDir, "catalog.yaml"));
  const skins: Record<string, Skin> = {};
  const dir = join(themeDir, "skins");
  for (const f of existsSync(dir) ? (await readdir(dir)).sort() : []) {
    if (!f.endsWith(".yaml")) continue;
    const skin = parseSkin(await readFile(join(dir, f), "utf8"), base);
    skins[skin.name] = skin;
  }
  const themes = existsSync(join(themeDir, "themes.yaml")) ? (parse(await readFile(join(themeDir, "themes.yaml"), "utf8")) ?? {}) as Record<string, { skin?: string }> : {};
  const theme = typeof params.theme === "string" ? params.theme : "paper";
  const skin = themes[theme]?.skin;
  const active = skin && skins[skin] ? skin : undefined;
  return { catalog: withSkin(base, skins, active), ...(active ? { skin: active } : {}) };
}

function rubricParams(config: string): Record<string, unknown> {
  try {
    const params = (Bun.TOML.parse(config) as { params?: { rubric?: unknown } }).params?.rubric;
    return typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// The nearest folder at or above `path` that holds rubric.md.
export function findSiteRoot(path: string): string | undefined {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "rubric.md"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

// A page's path inside pages/, or undefined when the file is not a page.
// rubric.md, where the frame around every page is chosen, is "rubric.md".
export function pagePath(site: Site, file: string): string | undefined {
  if (resolve(file) === join(site.root, "rubric.md")) return "rubric.md";
  const rel = relative(site.pages, file);
  return rel.startsWith("..") || !rel.endsWith(".md") ? undefined : rel;
}

export function pageKind(rel: string): PageKind {
  if (rel === "rubric.md") return "site";
  if (rel === "_index.md") return "home";
  return rel.split(sep)[0] === "posts" ? "post" : "page";
}
