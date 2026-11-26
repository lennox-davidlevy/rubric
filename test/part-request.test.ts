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
let text: string;

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
  text = [
    "---",
    "title: Parts",
    "---",
    "::: quote size=large align=center cite=\"A. Keeper\" : bigger",  // 3
    "Words.",
    ":::",
    "::: boulder-list",                                             // 6
    ":::",
    "Plain writing.",                                               // 8
    "::: post-list style=titles",                                   // 9
    "",                                                             // 10
    "",
  ].join("\n");
  await ws.open(page, text);
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
  expect(view.close).toBe(5);
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

test("a text and a number setting are set, and a number that is none is refused", async () => {
  const text = (await ws.part(page, 9, { name: "tag", value: "travel notes" })) as { replace: string };
  expect(text.replace).toBe('::: post-list style=titles tag="travel notes"');
  const number = (await ws.part(page, 9, { name: "count", value: "5" })) as { replace: string };
  expect(number.replace).toBe("::: post-list style=titles count=5");
  expect(await ws.part(page, 9, { name: "count", value: "five" })).toHaveProperty("error");
  const cleared = (await ws.part(page, 3, { name: "cite", value: "" })) as { replace: string };
  expect(cleared.replace).toBe("::: quote size=large align=center : bigger");
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

test("a part looked at on an empty line is drawn there, and goes when the look ends", async () => {
  const content = join(dir, "content/posts/part-request.md");
  const drawn = async (want: boolean) => {
    for (let i = 0; i < 100; i++) {
      await Bun.sleep(10);
      if (readFileSync(content, "utf8").includes("{{< divider") === want) return true;
    }
    return false;
  };
  ws.peek(page, 10, "divider");
  expect(await drawn(true)).toBe(true);
  ws.peek(page, 10);
  expect(await drawn(false)).toBe(true);
});

test("a part looked at on an empty line shows its starter, as a placed empty one does", async () => {
  const other = join(dir, "pages/posts/starter.md");
  const content = join(dir, "content/posts/starter.md");
  const starter = ws.site.catalog.parts.quote!.body!.trim();
  await ws.open(other, ["---", "title: Starter", "---", "Before.", "", "", "", "After."].join("\n"));
  const shows = async (want: boolean) => {
    for (let i = 0; i < 100; i++) {
      await Bun.sleep(10);
      const c = readFileSync(content, "utf8");
      if (c.includes("{{< quote") && c.includes(starter) === want) return true;
    }
    return false;
  };
  ws.peek(other, 5, "quote");
  expect(await shows(true)).toBe(true);
  ws.peek(other, 5);
  await ws.change(other, ["---", "title: Starter", "---", "Before.", "", "::: quote", ":::", "After."].join("\n"));
  expect(await shows(true)).toBe(true);
  await ws.close(other);
});

test("every part for the writing that holds writing has a starter", () => {
  const parts = Object.entries(ws.site.catalog.parts).filter(([, p]) => p.group && !p.empty);
  expect(parts.length).toBeGreaterThan(30);
  expect(parts.filter(([, p]) => !p.body?.trim()).map(([n]) => n)).toEqual([]);
});

test("a part looked at on a line goes when the text changes or the file closes", async () => {
  const content = join(dir, "content/posts/part-request.md");
  const drawn = async (want: boolean) => {
    for (let i = 0; i < 100; i++) {
      await Bun.sleep(10);
      if (readFileSync(content, "utf8").includes("{{< divider") === want) return true;
    }
    return false;
  };
  ws.peek(page, 10, "divider");
  expect(await drawn(true)).toBe(true);
  await ws.change(page, text.replace("Plain writing.", "Plain writing, changed."));
  expect(await drawn(false)).toBe(true);
  await ws.change(page, text);
  ws.peek(page, 10, "divider");
  expect(await drawn(true)).toBe(true);
  await ws.close(page);
  await ws.open(page, text);
  expect(await drawn(false)).toBe(true);
});

test("the parts say which take nothing inside", async () => {
  const { parts } = (await ws.parts(page)) as { parts: { name: string; empty?: true }[] };
  expect(parts.find((p) => p.name === "divider")?.empty).toBe(true);
  expect(parts.find((p) => p.name === "quote")?.empty).toBeUndefined();
});

test("with words the parts come in Jev's order", async () => {
  asked = [];
  const { parts } = (await ws.parts(page, "a big quote please")) as { parts: { name: string }[] };
  expect(asked).toEqual(["a big quote please"]);
  expect(parts[0]?.name).toBe("quote");
});
