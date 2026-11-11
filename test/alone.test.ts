// Parts that take nothing inside (a divider, a search box) have no closing
// `:::`, as the theme line has none: how the line is read, what Hugo gets,
// the frame, and accepting words that pick one. The universal catalog, and a
// temporary copy of the blog site switched to it, with the stub resolver.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atPlace, Cache, CatalogError, frame, parseCatalog, parsePlain, preprocess, scan, type Catalog, type PageKind } from "../src/core/index.ts";
import { stubResolver } from "../src/server/stub.ts";
import { Workspace } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";

const repo = join(import.meta.dir, "..");
const hugo = Bun.which("hugo");
let catalog: Catalog;
let dir: string;
let ws: Workspace;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rubric-alone-"));
  cpSync(join(repo, "sites/blog"), dir, { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  writeFileSync(join(dir, "hugo.toml"), readFileSync(join(dir, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const site = await openSite(dir);
  catalog = site.catalog;
  const stubs = { site: stubResolver(atPlace(catalog, "site"), 5), writing: stubResolver(atPlace(catalog, "writing"), 5) };
  const resolver = (d: string, p: PageKind) => stubs[p === "site" ? "site" : "writing"](d, p);
  ws = new Workspace(site, await Cache.load(site.cache), resolver, () => {}, { idleMs: 5, waitMs: 1000, drawMs: 5 });
});

afterAll(async () => {
  await ws.settle();
  await Bun.sleep(100);
  ws.dispose();
  rmSync(dir, { recursive: true, force: true });
});

describe("a part that takes nothing inside", () => {
  test("opens no block, so the block after it closes as usual", () => {
    const src = "::: divider style=ornament\n\n::: quote\nWords.\n:::\n";
    const s = scan(src, catalog);
    expect(s.directives.map((d) => [d.line, d.alone ?? false, d.close])).toEqual([[0, true, undefined], [2, false, 4]]);
    const out = preprocess(src, catalog);
    expect(out.diagnostics).toEqual([]);
    expect(out.entries.map((e) => e.placed)).toEqual([true, true]);
    expect(out.content.split("\n")[0]).toBe(`{{< divider style="ornament" />}}`);
  });

  test("inside a block, it leaves the block's closer to the block", () => {
    const out = preprocess("::: section\n::: divider\nWords.\n:::\n", catalog);
    expect(out.diagnostics).toEqual([]);
    expect(out.content.split("\n")).toEqual(["{{< section >}}", "{{< divider />}}", "Words.", "{{< /section >}}", ""]);
  });

  test("one with a setting still being typed has no block either", () => {
    const s = scan("::: section\n::: divider style=\n:::\n", catalog);
    expect(s.directives.map((d) => [d.alone ?? false, d.close])).toEqual([[false, 2], [true, undefined]]);
  });

  test("a closer under it closes nothing, and is noted", () => {
    const out = preprocess("::: divider\n:::\n", catalog);
    expect(out.diagnostics.map((d) => [d.line, d.code])).toEqual([[1, "stray-closer"]]);
    expect(out.entries[0]!.placed).toBe(true);
  });

  test("words that start with its name are words, and open a block", () => {
    const d = scan("::: search for something\n:::\n", catalog).directives[0]!;
    expect(d.kind).toBe("words");
    expect(d.close).toBe(1);
  });

  test("words that picked one: the part, and the block's closer gone from the page", () => {
    const src = "Before.\n::: a break here\n:::\nAfter.\n";
    const out = preprocess(src, catalog, () => parsePlain("divider"));
    expect(out.diagnostics).toEqual([]);
    expect(out.content.split("\n")).toEqual(["Before.", "{{< divider />}}", "", "After.", ""]);
  });

  test("in rubric.md, it's in the frame with no body", () => {
    const { entries } = frame("::: search\n\n::: footer\nMade by hand.\n:::\n", catalog, () => undefined);
    expect(entries.map((e) => [e.part, e.body])).toEqual([["search", ""], ["footer", "Made by hand."]]);
  });

  test("the catalog won't have one that holds parts or a starter body", () => {
    const yaml = (extra: string) => `name: x\nversion: 1\nparts:\n  rule:\n    description: d\n    empty: true\n${extra}`;
    expect(parseCatalog(yaml("")).parts.rule!.empty).toBe(true);
    expect(() => parseCatalog(yaml("    children: true\n"))).toThrow(CatalogError);
    expect(() => parseCatalog(yaml("    body: x\n"))).toThrow(CatalogError);
  });
});

test("accepting words that pick one takes the empty block's closer away too", async () => {
  const page = join(dir, "pages/posts/alone.md");
  // The stub picks the part the words name.
  const text = "---\ntitle: A\n---\n::: a divider please\n:::\n\nMore.\n";
  writeFileSync(page, text);
  await ws.open(page, text);
  await ws.settle();
  const divider = (await ws.ghost(page, 3)).find((g) => g.replace === "::: divider");
  expect(divider?.drop).toBe(4);
  // With something written in the block, the closer still goes; the writing
  // stays, after the part, as the page already drew it.
  await ws.change(page, "---\ntitle: A\n---\n::: a divider please\nWords.\n:::\n");
  await ws.settle();
  expect((await ws.ghost(page, 3)).find((g) => g.replace === "::: divider")?.drop).toBe(5);
});

test.skipIf(!hugo)("Hugo draws a part that takes nothing inside from its one call", () => {
  const s = mkdtempSync(join(tmpdir(), "rubric-hugo-alone-"));
  try {
    writeFileSync(join(s, "hugo.toml"), readFileSync(join(repo, "testing/hugo.toml"), "utf8")
      .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`));
    mkdirSync(join(s, "content/posts"), { recursive: true });
    writeFileSync(join(s, "content/posts/p.md"), "---\ntitle: P\n---\n\nBefore.\n\n{{< divider style=\"ornament\" />}}\n\nAfter.\n");
    const r = Bun.spawnSync([hugo!, "--quiet", "-s", s, "-d", join(s, "public")]);
    expect(r.stderr.toString()).toBe("");
    const html = readFileSync(join(s, "public/posts/p/index.html"), "utf8");
    const between = html.slice(html.indexOf("<p>Before.</p>"), html.indexOf("<p>After.</p>"));
    expect(between).toMatch(/divider/);
  } finally {
    rmSync(s, { recursive: true, force: true });
  }
});
