// The second pass: words after a pinned part's ":" are asked only about that
// part's settings, never on opening a page, and accepting rewrites the pin.
// Also the notes that came with it: a form that sends nowhere. A temporary
// copy of the review site on the universal catalog, with the stub resolvers.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRefine, atPlace, Cache, parseCatalog, parsePlain, refineQuestions, refineWords, resolveRefine, scan, splitRefine,
  type Answers,
} from "../src/core/index.ts";
import { stubRefiner, stubResolver } from "../src/server/stub.ts";
import { Workspace, type Note } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";

const repo = join(import.meta.dir, "..");
const catalog = parseCatalog(readFileSync(join(repo, "catalogs/universal/catalog.yaml"), "utf8"));

describe("the words after a colon", () => {
  test("split from the pin at a lone colon, never one inside a value", () => {
    expect(splitRefine("video width=wide : a bit bigger", 10)).toEqual({ plain: "video width=wide", refine: { words: "a bit bigger", colon: 27, start: 29 } });
    expect(splitRefine("subscribe to=https://x.y/z", 0)).toEqual({ plain: "subscribe to=https://x.y/z" });
    expect(splitRefine('quote cite="Ch. 2 : Home"', 0)).toEqual({ plain: 'quote cite="Ch. 2 : Home"' });
  });

  test("a pinned line keeps its words, its pin and its refinement", () => {
    const [d] = scan("::: a youtube video -> video : a bit bigger\n:::\n", catalog).directives;
    expect(d).toMatchObject({ kind: "pinned", words: "a youtube video", plain: { part: "video" }, refine: { words: "a bit bigger" }, problems: [] });
  });

  test("a plain line may have one too, and a bare colon is not yet a bad pin", () => {
    expect(scan("::: video : wider\n:::\n", catalog).directives[0]).toMatchObject({ kind: "plain", refine: { words: "wider" } });
    expect(scan("::: x -> video :\n:::\n", catalog).directives[0]!.problems).toEqual([]);
  });

  test("words with an arrow of their own still find the pin", () => {
    expect(scan("::: from a -> b -> video\n:::\n", catalog).directives[0]).toMatchObject({ words: "from a -> b", plain: { part: "video" } });
  });

  test("the cache reads the words however they are cased, spaced or ended", () => {
    expect(refineWords("  A bit   Bigger. ")).toBe("a bit bigger");
  });
});

describe("reading the answers", () => {
  const noul = (n: number) => ({ type: "noul", noul: n }) as const;
  const choice = (probabilities: Record<string, number>) => {
    const [best] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!;
    return { type: "choice", choice: best, probabilities } as const;
  };

  test("asks each setting whether the words speak to it, and what no setting covers", () => {
    const ids = Object.keys(refineQuestions(catalog, "video"));
    for (const id of ["beyond", "setting:video:width", "told:video:width", "setting:video:shadow", "told:video:shadow"]) expect(ids).toContain(id);
  });

  // The look settings, which the words leave alone in these tests.
  const lookUntold = (part: string) => Object.fromEntries(["shadow", "border", "corners", "text"].map((k) => [`told:${part}:${k}`, noul(0.05)]));

  test("a setting the words speak to takes their value; one they leave alone is left", () => {
    const answers = { ...lookUntold("video"), "told:video:width": noul(0.9), "setting:video:width": choice({ prose: 0.05, wide: 0.9, full: 0.05 }), beyond: noul(0.1) } as unknown as Answers;
    expect(resolveRefine(answers, catalog, "video")).toEqual({ settings: { width: "wide" }, unsettled: [], beyond: 0.1 });
    const quiet = { ...answers, "told:video:width": noul(0.1) } as unknown as Answers;
    expect(resolveRefine(quiet, catalog, "video").settings).toEqual({});
  });

  test("spoken to with no clear value is unsettled", () => {
    const answers = { ...lookUntold("pricing"), "told:pricing:featured": noul(0.9), "setting:pricing:featured": choice({ none: 0.1, last: 0.45, middle: 0.45 }), beyond: noul(0.8) } as unknown as Answers;
    expect(resolveRefine(answers, catalog, "pricing")).toEqual({ settings: {}, unsettled: ["featured"], beyond: 0.8 });
  });

  test("applied to a pin: new values in, defaults out, the rest kept", () => {
    const pin = parsePlain("chart kind=line")!;
    expect(applyRefine(pin, { settings: { kind: "bar" }, unsettled: [], beyond: 0 }, catalog)).toEqual({ part: "chart", settings: [] });
    const fig = parsePlain('figure width=wide')!;
    expect(applyRefine(fig, { settings: {}, unsettled: [], beyond: 0 }, catalog).settings).toEqual([{ key: "width", value: "wide" }]);
    expect(applyRefine(parsePlain("video")!, { settings: { width: "full" }, unsettled: [], beyond: 0 }, catalog).settings).toEqual([{ key: "width", value: "full" }]);
  });
});

describe("in the editor", () => {
  let dir: string;
  let ws: Workspace;
  const notes = new Map<string, Note[]>();
  let asked: string[] = [];
  const page = () => join(dir, "pages/posts/refine-test.md");

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rubric-refine-"));
    cpSync(join(repo, "sites/blog"), dir, { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
    writeFileSync(join(dir, "hugo.toml"), readFileSync(join(dir, "hugo.toml"), "utf8")
      .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
      .replace(/^theme = .*$/m, `theme = "universal"`));
    const site = await openSite(dir);
    const writing = stubResolver(atPlace(site.catalog, "writing"), 5);
    const refine = stubRefiner(site.catalog, 5);
    ws = new Workspace(site, await Cache.load(site.cache), writing, (f, n) => notes.set(f, n), {
      idleMs: 5, waitMs: 1000, drawMs: 5,
      refiner: async (words, part, kind) => {
        asked.push(`${part}: ${words}`);
        return refine(words, part, kind);
      },
    });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const head = "---\ntitle: T\n---\n";

  test("words left after the colon on a page when it opens are asked, like any others", async () => {
    await ws.open(page(), `${head}::: a video -> video : make it wide\nhttps://youtu.be/x\n:::\n`);
    await ws.settle();
    expect(asked).toEqual(["video: make it wide"]);
    expect((await ws.ghost(page(), 3))[0]?.replace).toBe("::: video width=wide");
    asked = [];
  });

  test("changed words are asked, once, and the ghost shows what changes", async () => {
    const line = "::: a video -> video : make it full";
    await ws.change(page(), `${head}${line}\nhttps://youtu.be/x\n:::\n`);
    await ws.settle();
    expect(asked).toEqual(["video: make it full"]);
    const [g] = await ws.ghost(page(), 3);
    expect(g).toEqual({ text: " ⇒ width=full", line: 3, character: line.length, replace: "::: video width=full" });
  });

  test("once accepted, the words are gone and the pin says it, so there is nothing more to offer", async () => {
    await ws.change(page(), `${head}::: video width=full\nhttps://youtu.be/x\n:::\n`);
    await ws.settle();
    expect(await ws.ghost(page(), 3)).toEqual([]);
    expect(readFileSync(join(dir, "content/posts/refine-test.md"), "utf8")).toContain('{{< video width="full" >}}');
  });

  test("the same words again, differently cased, are not asked again", async () => {
    asked = [];
    await ws.change(page(), `${head}::: a video -> video : Make it FULL.\nhttps://youtu.be/x\n:::\n`);
    await ws.settle();
    expect(asked).toEqual([]);
  });

  test("a look setting is something any part can do", async () => {
    await ws.change(page(), `${head}::: a video -> video : with a soft shadow\nhttps://youtu.be/x\n:::\n`);
    await ws.settle();
    const [g] = await ws.ghost(page(), 3);
    expect(g?.replace).toBe("::: video shadow=soft");
  });

  test("words asking for more than the part can do get a note on them", async () => {
    await ws.change(page(), `${head}::: a video -> video : with sparkles\nhttps://youtu.be/x\n:::\n`);
    await ws.settle();
    const n = (notes.get(page()) ?? []).find((x) => x.code === "beyond-part");
    expect(n).toMatchObject({ line: 3, start: 23 });
    expect(n!.message).toBe(
      "this asks for more than video's settings can say. video offers width prose, wide, full; shadow none, soft, deep; border none, outlined; corners theme, square, round; text normal, smaller, bigger",
    );
  });

  test("the note says what was taken when some of it fit", async () => {
    await ws.change(page(), `${head}::: a video -> video : wide, with sparkles\nhttps://youtu.be/x\n:::\n`);
    await ws.settle();
    const n = (notes.get(page()) ?? []).find((x) => x.code === "beyond-part");
    expect(n!.message).toStartWith("took width=wide, but some of this asks for more than video's settings can say. video offers width prose, wide, full;");
  });

  test("no completion after the colon: those words are for Jev", () => {
    const text = "::: a video -> video : wi";
    expect(ws.complete(page(), 3, text.length)).toEqual([]);
  });

  test("a form with nowhere to send says so, until it has an address", async () => {
    await ws.change(page(), `${head}::: signup -> subscribe\nGet posts.\n:::\n`);
    await ws.settle();
    const n = (notes.get(page()) ?? []).find((x) => x.code === "needs-setting");
    expect(n?.message).toContain("subscribe does not work yet: to is not set");
    expect(n?.message).toContain('`form = "…"` under [params.rubric]');
    await ws.change(page(), `${head}::: signup -> subscribe to=https://example.com/s\nGet posts.\n:::\n`);
    await ws.settle();
    expect((notes.get(page()) ?? []).some((x) => x.code === "needs-setting")).toBe(false);
  });
});
