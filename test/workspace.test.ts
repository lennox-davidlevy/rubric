// The server's behavior with the stub resolver, in a temporary copy of the
// slice site: content follows the buffer, notes on lines, ghost text,
// completion and hover.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  ws = new Workspace(site, await Cache.load(site.cache), stubResolver(site.catalog, 5), (f, n) => notes.set(f, n), { idleMs: 5, waitMs: 1000, drawMs: 5 });
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

  test("words lines on disk are asked at once, and the page is drawn again", async () => {
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
    const counting = new Workspace(ws.site, await Cache.load(ws.site.cache), async (d, p) => (asked++, stubResolver(ws.site.catalog, 1)(d, p)), () => {}, { idleMs: 1 });
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

  test("a new line is asked after a pause and waited for", async () => {
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

describe("when Jev is asked", () => {
  const counting = async (idleMs: number) => {
    const asked: string[] = [];
    const resolver = stubResolver(ws.site.catalog, 1);
    const w = new Workspace(ws.site, await Cache.load(join(dir, "no-cache.json")), async (d, p) => (asked.push(d), resolver(d, p)), () => {}, { idleMs, waitMs: 1000 });
    return { w, asked };
  };
  const draft = (line: string) => ["intro", `::: ${line}`, "body", ":::", ""].join("\n");

  test("the line being typed waits for a pause, and only its last version is sent", async () => {
    const { w, asked } = await counting(50);
    await w.open(page, draft("a"));
    for (const words of ["a b", "a bi", "a big", "a big quote"]) await w.change(page, draft(words));
    expect(asked).toEqual(["a"]);
    await Bun.sleep(120);
    expect(asked).toEqual(["a", "a big quote"]);
    await w.close(page);
  });

  test("leaving the line sends it at once", async () => {
    const { w, asked } = await counting(10_000);
    await w.open(page, draft("a"));
    await w.change(page, draft("a big quote"));
    await w.change(page, draft("a big quote").replace("body", "body, edited"));
    expect(asked).toEqual(["a", "a big quote"]);
    await w.close(page);
  });

  test("ghost text gives up when the line changes while it waits", async () => {
    const { w } = await counting(10_000);
    await w.open(page, draft("a big quote"));
    await w.change(page, draft("a big quote please"));
    const ghost = w.ghost(page, 1);
    await w.change(page, draft("a big quote please now"));
    expect(await ghost).toEqual([]);
    await w.close(page);
  });

  test("a burst of keystrokes is drawn once, after it pauses", async () => {
    const asked: string[] = [];
    const w = new Workspace(ws.site, await Cache.load(join(dir, "no-cache.json")), async (d, p) => (asked.push(d), stubResolver(ws.site.catalog, 1)(d, p)), () => {}, { idleMs: 10_000, waitMs: 1000, drawMs: 60 });
    await w.open(page, draft("x"));
    const before = statSync(join(dir, "content/posts/test.md")).mtimeMs;
    for (const body of ["Hello", "Hello w", "Hello wo", "Hello world"]) {
      await w.change(page, draft("x").replace("body", body));
      await Bun.sleep(20);
    }
    expect(content()).not.toContain("Hello");
    expect(statSync(join(dir, "content/posts/test.md")).mtimeMs).toBe(before);
    await Bun.sleep(100);
    expect(content()).toContain("\nHello world\n");
    expect(statSync(join(dir, "content/posts/test.md")).mtimeMs).toBeGreaterThan(before);
    await w.close(page);
  });

  test("overlapping renders leave the newest text in content/", async () => {
    const { w } = await counting(10_000);
    await w.open(page, draft("x"));
    await Promise.all(Array.from({ length: 20 }, (_, i) => w.change(page, draft("x").replace("body", `body ${i}`))));
    await w.settle();
    expect(content()).toContain("body 19");
    await w.close(page);
  });
});

describe("pictures", () => {
  let bdir: string;
  let bw: Workspace;
  let bpage: string;
  const bnotes = new Map<string, Note[]>();

  beforeAll(async () => {
    bdir = mkdtempSync(join(tmpdir(), "rubric-pics-"));
    cpSync(join(repo, "sites/blog"), bdir, { recursive: true, filter: (src) => !/\/(content|\.rubric)(\/|$)/.test(src) });
    writeFileSync(join(bdir, "hugo.toml"), readFileSync(join(bdir, "hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`));
    const site = await openSite(bdir);
    bw = new Workspace(site, await Cache.load(site.cache), stubResolver(site.catalog, 5), (f, n) => bnotes.set(f, n), { idleMs: 5, waitMs: 1000, drawMs: 5 });
    bpage = join(bdir, "pages/posts/pics.md");
  });

  afterAll(() => rmSync(bdir, { recursive: true, force: true }));

  const doc = (lines: string[]) => ["---", "title: Pics", "---", ...lines, ""].join("\n");
  const at = async (line: string) => {
    await bw.open(bpage, doc([line]));
    return bw.complete(bpage, 3, line.length);
  };

  test("an image setting's value offers the site's pictures, quoted, and nothing from the theme's fonts", async () => {
    const all = await at("::: hero image=");
    expect(all.map((c) => c.newText)).toContain('"/images/placeholder-field.jpg"');
    expect(all.every((c) => c.kind === "file" && !c.label.includes("fonts"))).toBe(true);
    const some = await at('::: a big opening -> hero image="/images/gal');
    expect(some.length).toBeGreaterThan(0);
    expect(some.every((c) => c.label.startsWith("/images/gallery/"))).toBe(true);
    expect(some[0]!.start).toBe('::: a big opening -> hero image='.length);
  });

  test("a Markdown picture's address offers them too, unquoted", async () => {
    const c = await at("Look: ![a field](/images/pl");
    expect(c.map((x) => x.newText)).toEqual(["/images/placeholder-field.jpg"]);
  });

  test("an address with no file behind it is a warning, in a setting and in Markdown", async () => {
    await bw.open(bpage, doc([
      '::: hero image="/image/sample.jpg"',         // 3: missing
      "# Title",                                     // 4
      ":::",                                         // 5
      "![ok](/images/placeholder-field.jpg)",        // 6: there
      "![gone](/images/nowhere.png) and ![far](https://example.com/x.png)", // 7: one missing, one not ours
      "```",                                         // 8
      "![in code](/nope.png)",                       // 9: code, ignored
      "```",                                         // 10
    ]));
    await bw.settle();
    const missing = (bnotes.get(bpage) ?? []).filter((n) => n.code === "missing-file");
    expect(missing.map((n) => [n.line, n.start, n.message])).toEqual([
      [3, 16, "no file at /image/sample.jpg in static/"],
      [7, 8, "no file at /images/nowhere.png in static/"],
    ]);
  });
});
