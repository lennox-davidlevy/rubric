#!/usr/bin/env bun
// The rubric command.
//
//   bun src/cli.ts lsp [--stub] [--harness claude|opencode] [--model <model>] [--effort <level>]
//                                   the language server, over stdio; what drafts
//                                   new parts unless one is chosen for a draft
//   bun src/cli.ts build <site>     write pages/ into content/ once
//   bun src/cli.ts watch <site>     the same on every save, for editors without the server
//
// build and watch use the cache only; words lines that are not cached stay as
// text until an editor with the server open resolves them.

import { watch } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { Cache, frame, FRAME_PAGE, framePage, preprocess } from "./core/index.ts";
import { HARNESSES, type Drafter, type HarnessName } from "./server/harness.ts";
import { serve } from "./server/main.ts";
import { writeHugoTree } from "./parts.ts";
import { openSite, pageKind, type Site } from "./site.ts";

const [command, ...args] = process.argv.slice(2);

if (command === "lsp") {
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  // The drafter named on the command line, whole: what isn't given is the
  // tool's default, not the built-in drafter's.
  const harness = flag("--harness");
  const model = flag("--model");
  const effort = flag("--effort");
  if (harness !== undefined && !HARNESSES.includes(harness as HarnessName)) {
    console.error(`--harness is one of ${HARNESSES.join(", ")}`);
    process.exit(2);
  }
  const named = harness !== undefined || model !== undefined || effort !== undefined;
  const drafter: Drafter = { harness: (harness as HarnessName | undefined) ?? "claude", ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  serve({ stub: args.includes("--stub"), ...(named ? { drafter } : {}) });
} else if ((command === "build" || command === "watch") && args[0]) {
  const site = await openSite(args[0]);
  const cache = await Cache.load(site.cache);
  await build(site, cache);
  if (command === "watch") {
    console.log(`watching ${site.pages} and rubric.md`);
    watch(join(site.root, "rubric.md"), async () => {
      try {
        await writeFrame(site, cache);
        console.log(`${new Date().toLocaleTimeString()} rubric.md`);
      } catch (err) {
        console.error(err);
      }
    });
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
  console.error("usage: rubric lsp [--stub] [--harness claude|opencode] [--model <model>] [--effort <level>] | rubric build|watch <site>");
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

// rubric.md's frame, into the page Hugo reads but never publishes.
async function writeFrame(site: Site, cache: Cache): Promise<void> {
  const text = await readFile(join(site.root, "rubric.md"), "utf8").catch(() => "");
  const { entries, output } = frame(text, site.catalog, cache.resolver(site.catalog, "site"));
  await mkdir(dirname(join(site.content, FRAME_PAGE)), { recursive: true });
  await writeFile(join(site.content, FRAME_PAGE), framePage(entries));
  for (const d of output.diagnostics) console.log(`rubric.md:${d.line + 1}:${d.start + 1}: ${d.code}: ${d.message}`);
  for (const e of output.entries) if (e.reason === "unresolved") console.log(`rubric.md:${e.line + 1}: words, not resolved yet: "${e.words}"`);
}

// Rewrites content/ in place and removes only pages that are gone. Deleting
// the folder itself would leave a running `hugo server` watching nothing.
async function build(site: Site, cache: Cache): Promise<void> {
  // The site's own parts, where its hugo.toml has Hugo look for them.
  await writeHugoTree(site.root, site.own);
  for (const p of site.ownProblems) console.log(`left out: ${p}`);
  const files = (await readdir(site.pages, { recursive: true })).filter((f) => f.endsWith(".md"));
  for (const f of files) await writePage(site, cache, join(site.pages, f));
  await writeFrame(site, cache);
  const keep = new Set([...files, FRAME_PAGE]);
  const existing = await readdir(site.content, { recursive: true }).catch(() => [] as string[]);
  for (const f of existing) if (f.endsWith(".md") && !keep.has(f)) await rm(join(site.content, f));
  console.log(`wrote ${files.length} page(s) to ${site.content}`);
}
