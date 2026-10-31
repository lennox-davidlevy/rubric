#!/usr/bin/env bun
// The rubric command.
//
//   bun src/cli.ts lsp [--stub]     the language server, over stdio
//   bun src/cli.ts build <site>     write pages/ into content/ once
//   bun src/cli.ts watch <site>     the same on every save, for editors without the server
//
// build and watch use the cache only; words lines that are not cached stay as
// text until an editor with the server open resolves them.

import { watch } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { Cache, preprocess } from "./core/index.ts";
import { serve } from "./server/main.ts";
import { openSite, pageKind, type Site } from "./site.ts";

const [command, ...args] = process.argv.slice(2);

if (command === "lsp") {
  serve({ stub: args.includes("--stub") });
} else if ((command === "build" || command === "watch") && args[0]) {
  const site = await openSite(args[0]);
  const cache = await Cache.load(site.cache);
  await build(site, cache);
  if (command === "watch") {
    console.log(`watching ${site.pages}`);
    watch(site.pages, { recursive: true }, async (_, name) => {
      if (!name?.endsWith(".md")) return;
      try {
        await writePage(site, cache, join(site.pages, name));
        console.log(`${new Date().toLocaleTimeString()} ${join("pages", name)}`);
      } catch (err) {
        // Deleted or renamed: drop its content so the preview matches.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") await rm(join(site.content, name), { force: true });
        else console.error(err);
      }
    });
  }
} else {
  console.error("usage: rubric lsp [--stub] | rubric build|watch <site>");
  process.exit(2);
}

async function writePage(site: Site, cache: Cache, file: string): Promise<void> {
  const rel = relative(site.pages, file);
  const out = preprocess(await readFile(file, "utf8"), site.catalog, cache.resolver(site.catalog, pageKind(rel)));
  await mkdir(dirname(join(site.content, rel)), { recursive: true });
  await writeFile(join(site.content, rel), out.content);
  for (const d of out.diagnostics) {
    console.log(`${join("pages", rel)}:${d.line + 1}:${d.start + 1}: ${d.code}: ${d.message}`);
  }
  for (const e of out.entries) {
    if (e.reason === "unresolved") console.log(`${join("pages", rel)}:${e.line + 1}: words, not resolved yet: "${e.words}"`);
  }
}

async function build(site: Site, cache: Cache): Promise<void> {
  await rm(site.content, { recursive: true, force: true });
  const files = (await readdir(site.pages, { recursive: true })).filter((f) => f.endsWith(".md"));
  for (const f of files) await writePage(site, cache, join(site.pages, f));
  console.log(`wrote ${files.length} page(s) to ${site.content}`);
}
