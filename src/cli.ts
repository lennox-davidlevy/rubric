// A dev command until the language server exists: writes a site's pages/ into
// Hugo's content/, once or on every save, and prints what it could not place.
//
//   bun src/cli.ts build sites/slice
//   bun src/cli.ts watch sites/slice

import { watch } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { loadCatalog, preprocess, type Catalog } from "./core/index.ts";

const [command, site] = process.argv.slice(2);
if ((command !== "build" && command !== "watch") || !site) {
  console.error("usage: bun src/cli.ts build|watch <site>");
  process.exit(2);
}

// The slice has one catalog, read from the theme the site's hugo.toml names.
const config = await readFile(join(site, "hugo.toml"), "utf8");
const theme = /^theme\s*=\s*"([^"]+)"/m.exec(config)?.[1];
const themesDir = /^themesDir\s*=\s*"([^"]+)"/m.exec(config)?.[1] ?? "themes";
if (!theme) throw new Error(`${site}/hugo.toml names no theme`);
const catalog = await loadCatalog(join(site, themesDir, theme, "catalog.yaml"));

const pages = join(site, "pages");
const content = join(site, "content");

async function writePage(catalog: Catalog, file: string): Promise<void> {
  const rel = relative(pages, file);
  const out = preprocess(await readFile(file, "utf8"), catalog);
  await mkdir(dirname(join(content, rel)), { recursive: true });
  await writeFile(join(content, rel), out.content);
  for (const d of out.diagnostics) {
    console.log(`${join("pages", rel)}:${d.line + 1}:${d.start + 1}: ${d.code}: ${d.message}`);
  }
  for (const e of out.entries) {
    if (e.reason === "unresolved") console.log(`${join("pages", rel)}:${e.line + 1}: words, not resolved (no Jev yet): "${e.words}"`);
  }
}

async function build(): Promise<void> {
  await rm(content, { recursive: true, force: true });
  const files = (await readdir(pages, { recursive: true })).filter((f) => f.endsWith(".md"));
  for (const f of files) await writePage(catalog, join(pages, f));
  console.log(`wrote ${files.length} page(s) to ${content}`);
}

await build();

if (command === "watch") {
  console.log(`watching ${pages}`);
  watch(pages, { recursive: true }, async (_, name) => {
    if (!name?.endsWith(".md")) return;
    const file = join(pages, name);
    try {
      await writePage(catalog, file);
      console.log(`${new Date().toLocaleTimeString()} ${join("pages", name)}`);
    } catch (err) {
      // Deleted or renamed: drop its content so the preview matches.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") await rm(join(content, name), { force: true });
      else console.error(err);
    }
  });
}
