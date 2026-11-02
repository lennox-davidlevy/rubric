// The frame around every page, chosen in rubric.md: the server writes it to
// the frame page, keeps each part to its place, completes only the parts that
// belong, and offers a part's starter body with the pick on an empty block.
// A temporary copy of the review site, switched to the universal catalog,
// with the stub resolver.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atPlace, Cache, frame, FRAME_PAGE, parseCatalog, type PageKind } from "../src/core/index.ts";
import { stubResolver } from "../src/server/stub.ts";
import { Workspace, type Note } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";

const repo = join(import.meta.dir, "..");
let dir: string;
let ws: Workspace;
const notes = new Map<string, Note[]>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rubric-frame-"));
  cpSync(join(repo, "sites/blog"), dir, { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  writeFileSync(join(dir, "hugo.toml"), readFileSync(join(dir, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const site = await openSite(dir);
  // As main.ts does: each line asked only about the parts for its place.
  const stubs = { site: stubResolver(atPlace(site.catalog, "site"), 5), writing: stubResolver(atPlace(site.catalog, "writing"), 5) };
  const resolver = (d: string, p: PageKind) => stubs[p === "site" ? "site" : "writing"](d, p);
  ws = new Workspace(site, await Cache.load(site.cache), resolver, (f, n) => notes.set(f, n), { idleMs: 5, waitMs: 1000, drawMs: 5 });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const framePage = () => JSON.parse(readFileSync(join(dir, "content", FRAME_PAGE), "utf8"));

describe("rubric.md", () => {
  const rubric = () => join(dir, "rubric.md");
  const text = [
    "warm, paper and ink",                  // 0
    "",                                     // 1
    "::: header sticky=stays",              // 2
    "- [Posts](/posts/)",                   // 3
    "- [About](/about/)",                   // 4
    ":::",                                  // 5
    "",                                     // 6
    "::: the breadcrumbs above the title",  // 7
    ":::",                                  // 8
    "",                                     // 9
    "::: quote",                            // 10
    "A quote does not go here.",            // 11
    ":::",                                  // 12
    "",                                     // 13
  ].join("\n");

  test("is written to the frame page, settings filled in, bodies kept", async () => {
    await ws.open(rubric(), text);
    await ws.settle();
    const page = framePage();
    expect(page.build).toEqual({ render: "never", list: "never" });
    expect(page.frame).toEqual([
      { part: "header", settings: { layout: "split", sticky: "stays" }, body: "- [Posts](/posts/)\n- [About](/about/)" },
      { part: "breadcrumbs", settings: {}, body: "" },
    ]);
  });

  test("a part for the writing is left out, and says where it goes", () => {
    const n = (notes.get(rubric()) ?? []).find((x) => x.code === "wrong-place");
    expect(n).toMatchObject({ line: 10, start: 4, end: 9 });
    expect(n!.message).toContain("quote goes in a page");
  });

  test("completes only the frame's parts", () => {
    const labels = ws.complete(rubric(), 2, 5).map((c) => c.label);
    expect(labels).toContain("header");
    expect(labels).not.toContain("hero");
  });

  test("a bare file still builds an empty frame", async () => {
    await ws.change(rubric(), "warm, paper and ink\n");
    await ws.settle();
    expect(framePage().frame).toEqual([]);
  });
});

describe("a page", () => {
  const page = () => join(dir, "pages/posts/frame-test.md");

  test("a frame part in a page is left as text, and says to use rubric.md", async () => {
    await ws.open(page(), "---\ntitle: T\n---\n::: footer\n:::\n");
    await ws.settle();
    const n = (notes.get(page()) ?? []).find((x) => x.code === "wrong-place");
    expect(n?.message).toBe("footer is part of the frame around every page: choose it in rubric.md");
    expect(readFileSync(join(dir, "content/posts/frame-test.md"), "utf8")).toContain("::: footer");
  });

  test("never completes a frame part", () => {
    const labels = ws.complete(page(), 3, 5).map((c) => c.label);
    expect(labels).toContain("fold");
    expect(labels).not.toContain("footer");
  });

  test("an empty block's ghost text brings the part's starter body; a full one does not", async () => {
    await ws.change(page(), "---\ntitle: T\n---\n::: steps please\n:::\n\n::: steps again\nAlready written.\n:::\n");
    await ws.settle();
    const [empty] = await ws.ghost(page(), 3);
    expect(empty!.text).toBe(" -> steps\n### The first step\n\nWhat to do.\n\n### The second step\n\nWhat to do next.");
    const [full] = await ws.ghost(page(), 6);
    expect(full!.text).toBe(" -> steps");
  });
});

describe("frame", () => {
  test("reads settings from a pinned line and fills the rest from the catalog", () => {
    const c = parseCatalog("name: x\nversion: 1\nparts:\n  footer:\n    description: d\n    place: site\n    children: true\n    settings:\n      layout: { type: choice, default: simple, values: { simple: s, columns: c } }\n");
    const { entries } = frame("::: a footer -> footer layout=columns\nSmall print.\n:::\n", c, () => undefined);
    expect(entries).toEqual([{ part: "footer", settings: { layout: "columns" }, body: "Small print." }]);
  });
});
