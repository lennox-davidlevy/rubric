// A site from nothing: `rubric new` makes the writer's files only, and
// `rubric build` publishes it with the pinned Hugo, drawn in Paper.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "../src/build.ts";
import { hugoPath } from "../src/hugo.ts";
import { newSite, titleOf } from "../src/new-site.ts";
import { openSite } from "../src/site.ts";

const tmp = mkdtempSync(join(tmpdir(), "rubric-new-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("a new site is named for its folder and holds no Hugo settings of Rubric's", async () => {
  const made = newSite(join(tmp, "my-garden"));
  expect(made).toEqual({ root: join(tmp, "my-garden") });
  const config = readFileSync(join(tmp, "my-garden/hugo.toml"), "utf8");
  expect(Bun.TOML.parse(config)).toMatchObject({ title: "My Garden" });
  expect(config).not.toContain("mounts");
  expect(config).not.toMatch(/^theme/m);
  const site = await openSite(join(tmp, "my-garden"));
  expect(site.theme).toBe("paper");
  expect(Object.keys(site.catalog.parts)).toContain("quote");
  expect(titleOf("/x/field_notes")).toBe("Field Notes");
});

test("a folder with anything in it is refused and left alone", () => {
  const full = join(tmp, "full");
  mkdirSync(full);
  writeFileSync(join(full, "notes.txt"), "mine\n");
  expect("error" in newSite(full)).toBe(true);
  expect(existsSync(join(full, "rubric.md"))).toBe(false);
});

test.skipIf(!hugoPath())("a new site builds to public/, with its post drawn in the default theme and parts placed", async () => {
  const root = join(tmp, "built");
  newSite(root);
  writeFileSync(join(root, "pages/posts/first.md"), "---\ntitle: The first post\n---\n\n::: quote size=large\nSaid once.\n:::\n");
  const built = await buildSite(await openSite(root), () => {});
  expect(built).toEqual({ public: join(root, "public") });
  const html = readFileSync(join(root, "public/posts/first/index.html"), "utf8");
  expect(html).toContain("part-quote");
  expect(html).toMatch(/paper-[^"]*\.css/);
  // The draft area and Rubric's config stay out of what is published.
  expect(existsSync(join(root, "public/rubric-frame"))).toBe(false);
  expect(existsSync(join(root, ".rubric/hugo.toml"))).toBe(true);
});

test.skipIf(!hugoPath())("a build draws the site in rubric.md's theme", async () => {
  const root = join(tmp, "themed");
  newSite(root);
  writeFileSync(join(root, "rubric.md"), "::: theme terminal\n");
  expect(await buildSite(await openSite(root), () => {})).toEqual({ public: join(root, "public") });
  const html = readFileSync(join(root, "public/posts/first/index.html"), "utf8");
  expect(html).toMatch(/terminal-[^"]*\.css/);
  expect(html).not.toMatch(/paper-[^"]*\.css/);
});

test.skipIf(!hugoPath())("a built page finds its styles and scripts from wherever public/ is opened", async () => {
  const root = join(tmp, "portable");
  newSite(root);
  expect(await buildSite(await openSite(root), () => {})).toEqual({ public: join(root, "public") });
  const html = readFileSync(join(root, "public/posts/first/index.html"), "utf8");
  // Relative to the page, so it works under any path or from disk, where a
  // browser also refuses a file that carries an integrity check.
  expect(html).toMatch(/rel="?stylesheet"? href="?\.\.\/\.\.\/css\//);
  expect(html).not.toMatch(/href="?\/css\//);
  expect(html).not.toContain("integrity=");
});

test.skipIf(!hugoPath())("a site's own relativeURLs decides how a build links", async () => {
  const root = join(tmp, "absolute");
  newSite(root);
  writeFileSync(join(root, "hugo.toml"), `relativeURLs = false\n${readFileSync(join(root, "hugo.toml"), "utf8")}`);
  expect(await buildSite(await openSite(root), () => {})).toEqual({ public: join(root, "public") });
  expect(readFileSync(join(root, "public/posts/first/index.html"), "utf8")).toMatch(/href="?\/css\//);
});
