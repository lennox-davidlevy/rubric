// What the server answers the app about parts (`rubric/part`, `rubric/parts`),
// with the stub resolver, in a temporary copy of the testing site.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atPlace, Cache, type PageKind } from "../src/core/index.ts";
import { stubResolver } from "../src/server/stub.ts";
import { Workspace, type PartView } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";
import { copyTestingSite } from "./testing-site.ts";

const repo = join(import.meta.dir, "..");
let dir: string;
let ws: Workspace;
let asked: string[] = [];
let page: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rubric-part-"));
  copyTestingSite(dir);
  writeFileSync(join(dir, "hugo.toml"), `theme = "universal"\nthemesDir = ${JSON.stringify(join(repo, "catalogs"))}\n${readFileSync(join(dir, "hugo.toml"), "utf8")}`);
  const site = await openSite(dir);
  const resolver = (d: string, p: PageKind) => {
    asked.push(d);
    return stubResolver(atPlace(site.catalog, p === "site" ? "site" : "writing"), 5)(d, p);
  };
  ws = new Workspace(site, await Cache.load(site.cache), resolver, () => {}, { idleMs: 5, waitMs: 1000, drawMs: 5 });
  page = join(dir, "pages/posts/part-request.md");
  await ws.open(page, [
    "---",
    "title: Parts",
    "---",
    "::: quote size=large align=center cite=\"A. Keeper\" : bigger",  // 3
    "Words.",
    ":::",
    "::: boulder-list",                                             // 6
    ":::",
    "Plain writing.",                                               // 8
    "",
  ].join("\n"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a placed part answers its settings with the line's values, then the look's defaults", async () => {
  const view = (await ws.part(page, 3)) as PartView;
  expect(view.name).toBe("quote");
  expect(view.kind).toBe("catalog");
  expect(view.uses.blocks).toBeGreaterThanOrEqual(1);
  const size = view.settings.find((s) => s.name === "size")!;
  expect(size.value).toBe("large");
  expect(size.values).toContain("normal");
  expect(view.settings.find((s) => s.name === "cite")?.type).toBe("text");
  const shadow = view.look.find((s) => s.name === "shadow")!;
  expect(shadow.value).toBeUndefined();
  expect(shadow.values).toContain(shadow.default!);
  expect(view.settings.some((s) => s.name === "shadow")).toBe(false);
  expect(((await ws.part(page, 6)) as PartView).kind).toBe("own");
  expect(await ws.part(page, 8)).toBeUndefined();
});

test("setting the default drops the setting and keeps the others in place", async () => {
  const done = (await ws.part(page, 3, { name: "size", value: "normal" })) as { replace: string };
  expect(done.replace).toBe("::: quote align=center cite=\"A. Keeper\" : bigger");
  const added = (await ws.part(page, 3, { name: "shadow", value: "soft" })) as { replace: string };
  expect(added.replace).toBe("::: quote size=large align=center cite=\"A. Keeper\" shadow=soft : bigger");
});

test("a value or a setting the part does not have is refused", async () => {
  expect(await ws.part(page, 3, { name: "size", value: "huge" })).toHaveProperty("error");
  expect(await ws.part(page, 3, { name: "colour", value: "blue" })).toHaveProperty("error");
});

test("the parts with no words list the site's own first, then the catalog's by group, asking nothing", async () => {
  asked = [];
  const { parts } = (await ws.parts(page)) as { parts: { name: string; own?: true; group?: string }[] };
  const firstCatalog = parts.findIndex((p) => !p.own);
  expect(firstCatalog).toBeGreaterThan(0);
  expect(parts.slice(firstCatalog).every((p) => !p.own && p.group)).toBe(true);
  expect(parts.some((p) => p.name === "boulder-list" && p.own)).toBe(true);
  // Each group once, in a run.
  const groups = parts.slice(firstCatalog).map((p) => p.group);
  expect(new Set(groups).size).toBe(groups.filter((g, i) => g !== groups[i - 1]).length);
  expect(asked).toEqual([]);
});

test("with words the parts come in Jev's order", async () => {
  asked = [];
  const { parts } = (await ws.parts(page, "a big quote please")) as { parts: { name: string }[] };
  expect(asked).toEqual(["a big quote please"]);
  expect(parts[0]?.name).toBe("quote");
});
