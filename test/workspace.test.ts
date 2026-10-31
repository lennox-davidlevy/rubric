// The server's behaviour with the stub resolver, in a temporary copy of the
// slice site: content follows the buffer, notes on lines, ghost text,
// completion and hover.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../src/core/index.ts";
import { stubResolver } from "../src/server/stub.ts";
import { Workspace, type Note } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";

const repo = join(import.meta.dir, "..");
let dir: string;
let ws: Workspace;
const notes = new Map<string, Note[]>();
let page: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rubric-ws-"));
  cpSync(join(repo, "sites/slice"), dir, { recursive: true, filter: (src) => !/\/(content|\.rubric)(\/|$)/.test(src) });
  writeFileSync(join(dir, "hugo.toml"), readFileSync(join(dir, "hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`));
  const site = await openSite(dir);
  ws = new Workspace(site, await Cache.load(site.cache), stubResolver(site.catalog, 5), (f, n) => notes.set(f, n), { debounceMs: 5, waitMs: 1000 });
  page = join(dir, "pages/posts/test.md");
  writeFileSync(page, "on disk\n");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const content = () => readFileSync(join(dir, "content/posts/test.md"), "utf8");
const codes = () => (notes.get(page) ?? []).map((n) => `${n.line}:${n.code}`);

const text = [
  "---",                                // 0
  "title: Test",                        // 1
  "---",                                // 2
  "::: callout kind=warning",           // 3
  "Plain form.",                        // 4
  ":::",                                // 5
  "::: a big quote please",             // 6
  "Words, resolved by the stub.",       // 7
  ":::",                                // 8
  "::: a spreadsheet of my taxes",      // 9
  "Nothing fits.",                      // 10
  ":::",                                // 11
  "::: offline line",                   // 12
  "The stub fails this one.",           // 13
  ":::",                                // 14
  "::: quote size=huge",                // 15
  "A bad value.",                       // 16
  ":::",                                // 17
  "```",                                // 18
  "::: in code",                        // 19
  "```",                                // 20
  "",                                   // 21
].join("\n");

describe("the document flow", () => {
  test("content follows the buffer before anything is resolved", async () => {
    await ws.open(page, text);
    expect(content().split("\n")[3]).toBe(`{{< callout kind="warning" >}}`);
    expect(content().split("\n")[6]).toBe("::: a big quote please");
    expect(codes()).toEqual(["15:value-not-allowed"]);
  });

  test("words lines are resolved after the debounce, and the page is drawn again", async () => {
    await ws.settle();
    expect(content().split("\n")[6]).toBe(`{{< quote size="large" >}}`);
    expect(content().split("\n")[8]).toBe(`{{< /quote >}}`);
    expect(content().split("\n")[9]).toBe("::: a spreadsheet of my taxes");
    expect(codes().sort()).toEqual(["12:jev-error", "15:value-not-allowed", "9:nothing-fits"]);
    expect(existsSync(join(dir, ".rubric/cache.json"))).toBe(true);
    expect(existsSync(join(dir, ".rubric/sidecar/posts/test.md.json"))).toBe(true);
  });

  test("an edit is drawn at once, and a resolved line is never asked again", async () => {
    let asked = 0;
    const counting = new Workspace(ws.site, await Cache.load(ws.site.cache), async (d, p) => (asked++, stubResolver(ws.site.catalog, 1)(d, p)), () => {}, { debounceMs: 1 });
    await counting.open(page, text.replace("Plain form.", "Edited."));
    await counting.settle();
    expect(content()).toContain("Edited.");
    expect(asked).toBe(1); // only the offline line, whose error is not cached
  });

  test("closing a page draws it from disk again", async () => {
    await ws.close(page);
    expect(content()).toBe("on disk\n");
    await ws.open(page, text);
    await ws.settle();
  });
});

describe("ghost text", () => {
  test("a placed line offers its plain form at the end of the line", async () => {
    expect(await ws.ghost(page, 6)).toEqual([{ text: " -> quote size=large", line: 6, character: "::: a big quote please".length }]);
  });

  test("a line ending in a space gets no second space", async () => {
    await ws.change(page, text.replace("::: a big quote please", "::: a big quote please "));
    expect((await ws.ghost(page, 6))[0]!.text).toBe("-> quote size=large");
    await ws.change(page, text);
  });

  test("a new line is asked at once and waited for", async () => {
    await ws.change(page, text.replace("::: a spreadsheet of my taxes", "::: a slow callout"));
    expect((await ws.ghost(page, 9))[0]!.text).toBe(" -> callout");
    await ws.change(page, text);
  });

  test("nothing for lines that are not words, nothing for nothing-fits", async () => {
    expect(await ws.ghost(page, 3)).toEqual([]);
    expect(await ws.ghost(page, 9)).toEqual([]);
    expect(await ws.ghost(page, 19)).toEqual([]);
  });
});

describe("completion", () => {
  const at = async (line: string) => {
    await ws.change(page, text.replace("::: quote size=huge", line));
    return ws.complete(page, 15, line.length).map((c) => c.newText);
  };

  test("after ::: the parts", async () => {
    expect((await at("::: ")).sort()).toEqual(["callout", "quote", "section"]);
    expect(await at("::: q")).toEqual(["quote"]);
  });

  test("after a part its settings, then a setting's values", async () => {
    expect((await at("::: quote ")).sort()).toEqual(["align=", "cite=", "size="]);
    expect(await at("::: quote size=")).toEqual(["normal", "large"]);
    expect(await at("::: quote size=l")).toEqual(["large"]);
    expect((await at("::: quote size=large ")).sort()).toEqual(["align=", "cite="]);
  });

  test("after a pin's arrow, the same", async () => {
    expect(await at("::: a box -> sec")).toEqual(["section"]);
  });

  test("words get nothing, and neither does code", async () => {
    expect(await at("::: a big ")).toEqual([]);
    expect(ws.complete(page, 19, 5)).toEqual([]);
    await ws.change(page, text);
  });
});

describe("hover", () => {
  test("a words line says what it became", () => {
    expect(ws.hover(page, 6)).toContain("**Placed** as `quote size=large`");
    expect(ws.hover(page, 9)).toContain("Nothing in the catalog fits");
    expect(ws.hover(page, 12)).toContain("Could not reach Jev");
  });

  test("a plain form explains its part and settings", () => {
    expect(ws.hover(page, 3)).toContain("**callout**");
    expect(ws.hover(page, 3)).toContain("`kind=warning`: something that could go wrong");
  });
});
