// A site's pages into Hugo's content/, from the cache alone, and the finished
// site into public/ with the pinned Hugo.
//
// Words lines that are not cached stay as text until an editor with the
// server open resolves them.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { Cache, frame, FRAME_PAGE, framePage, preprocess } from "./core/index.ts";
import { hugoSiteArgs, readConfig } from "./hugo-config.ts";
import { ensureHugo } from "./hugo.ts";
import { writeHugoTree } from "./parts.ts";
import { pageKind, type Site } from "./site.ts";

// Where what a build finds goes: a page's mistakes, words not resolved yet.
export type Say = (line: string) => void;

export async function writePage(site: Site, cache: Cache, file: string, say: Say = console.log): Promise<void> {
  const rel = relative(site.pages, file);
  const out = preprocess(await readFile(file, "utf8"), site.catalog, cache.resolver(site.catalog, pageKind(rel)));
  await mkdir(dirname(join(site.content, rel)), { recursive: true });
  await writeFile(join(site.content, rel), out.content);
  for (const d of out.diagnostics) say(`${join("pages", rel)}:${d.line + 1}:${d.start + 1}: ${d.code}: ${d.message}`);
  for (const e of out.entries) if (e.reason === "unresolved") say(`${join("pages", rel)}:${e.line + 1}: words, not resolved yet: "${e.words}"`);
}

// rubric.md's frame, into the page Hugo reads but never publishes.
export async function writeFrame(site: Site, cache: Cache, say: Say = console.log): Promise<void> {
  const text = await readFile(join(site.root, "rubric.md"), "utf8").catch(() => "");
  const { entries, output } = frame(text, site.catalog, cache.resolver(site.catalog, "site"));
  await mkdir(dirname(join(site.content, FRAME_PAGE)), { recursive: true });
  // With the theme line's theme, which the layout draws the site in.
  await writeFile(join(site.content, FRAME_PAGE), framePage(entries, output.theme));
  for (const d of output.diagnostics) say(`rubric.md:${d.line + 1}:${d.start + 1}: ${d.code}: ${d.message}`);
  for (const e of output.entries) if (e.reason === "unresolved") say(`rubric.md:${e.line + 1}: words, not resolved yet: "${e.words}"`);
}

// Rewrites content/ in place and removes only pages that are gone. Deleting
// the folder itself would leave a running `hugo server` watching nothing.
export async function writeContent(site: Site, cache: Cache, say: Say = console.log): Promise<number> {
  // The site's own parts, where Hugo looks for them.
  await writeHugoTree(site.root, site.own);
  for (const p of site.ownProblems) say(`left out: ${p}`);
  const files = (await readdir(site.pages, { recursive: true }).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
  for (const f of files) await writePage(site, cache, join(site.pages, f), say);
  await writeFrame(site, cache, say);
  const keep = new Set([...files, FRAME_PAGE]);
  const existing = await readdir(site.content, { recursive: true }).catch(() => [] as string[]);
  for (const f of existing) if (f.endsWith(".md") && !keep.has(f)) await rm(join(site.content, f));
  return files.length;
}

// Hugo's keys are any case; a hugo.toml that does not parse is Hugo's to report.
function ownsRelativeURLs(root: string): boolean {
  try {
    return Object.keys(Bun.TOML.parse(readConfig(root))).some((k) => k.toLowerCase() === "relativeurls");
  } catch {
    return false;
  }
}

// The whole site, ready to publish, in public/.
export async function buildSite(site: Site, say: Say = console.log): Promise<{ public: string } | { error: string }> {
  const cache = await Cache.load(site.cache);
  await writeContent(site, cache, say);
  const hugo = await ensureHugo();
  if ("error" in hugo) return hugo;
  const out = join(site.root, "public");
  // Links relative to each page, so public/ works wherever it is put: in a
  // folder of a host, under a path, or opened from disk. The site's own
  // hugo.toml decides when it says.
  const relative = ownsRelativeURLs(site.root) ? {} : { HUGO_RELATIVEURLS: "true" };
  const proc = Bun.spawn([hugo.path, ...(await hugoSiteArgs(site.root)), "--minify", "--cleanDestinationDir", "-d", out], {
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, ...relative },
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  const errors = stderr.split("\n").filter((l) => /ERROR/.test(l));
  if (code !== 0 || errors.length) return { error: `Hugo could not build it: ${(errors.join(" ") || stderr.trim() || `exit ${code}`).slice(0, 600)}` };
  return { public: out };
}
