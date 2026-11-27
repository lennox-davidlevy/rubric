// What the server answers for `rubric/pages` on a temporary copy of `testing/`.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { atPlace, Cache, type PageKind } from "../src/core/index.ts";
import { stubResolver } from "../src/server/stub.ts";
import { Workspace } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";
import { copyTestingSite } from "./testing-site.ts";

const repo = join(import.meta.dir, "..");
let dir: string;
let ws: Workspace;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rubric-pages-"));
  copyTestingSite(dir);
  writeFileSync(
    join(dir, "hugo.toml"),
    `theme = "universal"\nthemesDir = ${JSON.stringify(join(repo, "catalogs"))}\n${readFileSync(join(dir, "hugo.toml"), "utf8")}`,
  );
  // Add a draft post, an undated post, a heading-only post, and a post with unparseable front matter.
  writeFileSync(
    join(dir, "pages/posts/draft-note.md"),
    "---\ntitle: Harbour draft\ndate: 2026-11-12\ndraft: true\n---\n\nUnfinished.\n",
  );
  writeFileSync(
    join(dir, "pages/posts/undated-a.md"),
    "---\ntitle: Zebra undated\n---\n\nNo date.\n",
  );
  writeFileSync(
    join(dir, "pages/posts/undated-b.md"),
    "# Alpha undated\n\nHeading only.\n",
  );
  writeFileSync(
    join(dir, "pages/posts/bad-fm.md"),
    "---\ntitle: [unclosed\ndate: 2026-12-01\n---\n\n# Should not be used\n",
  );
  const site = await openSite(dir);
  const resolver = (d: string, p: PageKind) => stubResolver(atPlace(site.catalog, p === "site" ? "site" : "writing"), 5)(d, p);
  ws = new Workspace(site, await Cache.load(site.cache), resolver, () => {}, { idleMs: 5, waitMs: 1000, drawMs: 5 });
});

afterAll(() => {
  ws.dispose();
  rmSync(dir, { recursive: true, force: true });
});

test("rubric/pages lists home first, pages by title, posts newest first with undated last, and draft only where set", async () => {
  const res = await ws.pages();
  expect(res.site).toBe("Field Notes");

  // rubric.md is never listed.
  expect(res.pages.some((p) => p.uri.endsWith("/rubric.md"))).toBe(false);

  // Home is first.
  expect(res.pages[0]?.kind).toBe("home");
  expect(res.pages[0]?.uri).toBe(pathToFileURL(join(dir, "pages/_index.md")).href);

  // Pages follow home, sorted by title.
  const firstPost = res.pages.findIndex((p) => p.kind === "post");
  expect(firstPost).toBeGreaterThan(1);
  const pages = res.pages.slice(1, firstPost);
  expect(pages.every((p) => p.kind === "page")).toBe(true);
  expect(pages.map((p) => p.title)).toEqual([
    "À propos",
    "About",
    "Every part",
    "Things that are wrong",
  ]);

  // Posts follow pages: dated newest first, then undated by title.
  const posts = res.pages.slice(firstPost);
  expect(posts.every((p) => p.kind === "post")).toBe(true);
  const dated = posts.filter((p) => p.date !== undefined);
  const undated = posts.filter((p) => p.date === undefined);
  expect(posts.slice(0, dated.length)).toEqual(dated);
  expect(dated.map((p) => p.date)).toEqual([...dated.map((p) => p.date)].sort().reverse());
  expect(dated[0]?.title).toBe("Harbour draft");
  expect(dated[0]?.date).toBe("2026-11-12");

  // Undated posts come last, sorted by title; bad front matter gives the file name and no date.
  expect(undated.map((p) => p.title)).toEqual([
    "Alpha undated",
    "bad-fm.md",
    "Zebra undated",
  ]);
  expect(undated.find((p) => p.title === "bad-fm.md")?.date).toBeUndefined();

  // draft is true only where front matter explicitly sets draft: true.
  expect(res.pages.filter((p) => p.draft).map((p) => p.title)).toEqual(["Harbour draft"]);
});

test("rubric/pages reads an open document's unsaved editor text and falls back to the folder name without a home title", async () => {
  const walk = join(dir, "pages/posts/walk.md");
  const original = readFileSync(walk, "utf8");
  await ws.open(walk, original.replace("title: The walk home", "title: Unsaved walk title"));
  const withOpen = await ws.pages();
  expect(withOpen.pages.find((p) => p.uri === pathToFileURL(walk).href)?.title).toBe("Unsaved walk title");
  await ws.close(walk);

  // After closing, disk content is read again.
  const afterClose = await ws.pages();
  expect(afterClose.pages.find((p) => p.uri === pathToFileURL(walk).href)?.title).toBe("The walk home");

  // If _index.md is open with no title or heading, site falls back to the folder's name.
  const home = join(dir, "pages/_index.md");
  await ws.open(home, "Plain home without heading.\n");
  const fallback = await ws.pages();
  expect(fallback.site).toBe(basename(dir));
  await ws.close(home);
});
