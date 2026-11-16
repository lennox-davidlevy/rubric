// What Hugo needs to draw a Rubric site, written by Rubric into
// .rubric/hugo.toml whenever it runs Hugo, so a site's own hugo.toml holds
// only the writer's settings (title, params, languages). Hugo reads both,
// Rubric's first: `--config .rubric/hugo.toml,hugo.toml`, and the site's file
// wins wherever both set something.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { writeWhole } from "./core/write.ts";

// The catalogs that ship with Rubric, and the one a site uses unless its
// hugo.toml names another.
export const CATALOGS = join(import.meta.dir, "..", "catalogs");
export const DEFAULT_CATALOG = "universal";
export const RUBRIC_CONFIG = ".rubric/hugo.toml";

// The catalog's folder for a site: the one its hugo.toml names (`theme`,
// with `themesDir` from the site), else the universal one Rubric ships with.
// Hugo's theme is the catalog; Rubric's theme is a look inside it.
export function siteThemeDir(root: string, config = readConfig(root)): string {
  // Top-level keys only: [params.rubric] has a `theme` of its own.
  let top: Record<string, unknown> = {};
  try {
    top = Bun.TOML.parse(config) as Record<string, unknown>;
  } catch {
    // Hugo says what is wrong with it.
  }
  const catalog = typeof top.theme === "string" ? top.theme : DEFAULT_CATALOG;
  const themesDir = typeof top.themesDir === "string" ? top.themesDir : undefined;
  return themesDir === undefined ? join(CATALOGS, catalog) : resolve(root, themesDir, catalog);
}

export function readConfig(root: string): string {
  const file = join(root, "hugo.toml");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

// `themeDir` is the catalog's folder.
export function rubricHugoConfig(themeDir: string): string {
  const q = (s: string) => JSON.stringify(s);
  // The site's own parts and the draft being looked at are written into
  // .rubric/hugo/ (src/parts.ts), beside the site's own folders. A mount
  // replaces Hugo's default for its folder, so each is named.
  const mounts = ["layouts", "assets", "data"]
    .flatMap((f) => [`[[module.mounts]]\nsource = "${f}"\ntarget = "${f}"`, `[[module.mounts]]\nsource = ".rubric/hugo/${f}"\ntarget = "${f}"`])
    .join("\n");
  return `# Written by Rubric each time it runs Hugo. Change hugo.toml instead: it
# is read after this file and wins.
theme = ${q(basename(themeDir))}
themesDir = ${q(dirname(themeDir))}
disableKinds = ["sitemap"]

${mounts}

# Nested parts hand their HTML to the outer part's RenderString.
[markup.goldmark.renderer]
unsafe = true

[markup.highlight]
noClasses = false

# For \`hugo server\` only. Its Last-Modified is to the second, so two rebuilds
# in one second answer the browser's reload with 304 Not Modified and the
# browser keeps the older page. Rubric rebuilds as the writer types.
[[server.headers]]
for = "/**"
[server.headers.values]
Cache-Control = "no-store"
`;
}

// Writes .rubric/hugo.toml when it differs, and gives the arguments that
// point Hugo at the site with it.
export async function hugoSiteArgs(root: string): Promise<string[]> {
  const file = join(root, RUBRIC_CONFIG);
  const text = rubricHugoConfig(siteThemeDir(root));
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
    mkdirSync(dirname(file), { recursive: true });
    await writeWhole(file, text);
  }
  const own = join(root, "hugo.toml");
  return ["-s", root, "--config", existsSync(own) ? `${file},${own}` : file];
}
