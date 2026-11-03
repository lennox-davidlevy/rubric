// Skins and the look settings. A skin adds settings to the catalog's parts
// and parts of its own while it is the site's skin; in any other skin, a pin
// that uses them is kept, drawn without them, and noted, never broken. The
// look settings (shadow, border, corners, text) every part in the writing
// has, asked once a line.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRefine, atPlace, buildQuestions, Cache, lookQuestions, parseCatalog, parsePlain, parseSkin, preprocess, refineQuestions, resolve,
  settingsOf, withSkin, type Answers,
} from "../src/core/index.ts";
import { stubResolver } from "../src/server/stub.ts";
import { Workspace, type Note } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";

const repo = join(import.meta.dir, "..");
const base = parseCatalog(readFileSync(join(repo, "catalogs/universal/catalog.yaml"), "utf8"));
const blowfish = parseSkin(readFileSync(join(repo, "catalogs/universal/skins/blowfish.yaml"), "utf8"), base);
const skins = { blowfish };
const inBlowfish = withSkin(base, skins, "blowfish");
const inPaper = withSkin(base, skins);

describe("a skin's additions", () => {
  test("are in the catalog while it is the site's skin", () => {
    expect(Object.keys(settingsOf(inBlowfish, "callout"))).toContain("icon");
    expect(inBlowfish.parts.lead?.description).toContain("opening paragraph");
    expect(inBlowfish.skin).toEqual({ name: "blowfish", version: 1 });
    expect(inBlowfish.elsewhere).toEqual({ parts: {}, settings: {} });
  });

  test("are remembered, not offered, in any other skin", () => {
    expect(Object.keys(settingsOf(inPaper, "callout"))).not.toContain("icon");
    expect(inPaper.parts.lead).toBeUndefined();
    expect(inPaper.elsewhere).toEqual({ parts: { lead: "blowfish" }, settings: { callout: { icon: "blowfish" } } });
  });

  test("a skin may not redefine what the catalog has", () => {
    expect(() => parseSkin("name: x\nversion: 1\nparts:\n  callout:\n    settings:\n      kind: { type: text }\n", base)).toThrow("already has it");
    expect(() => parseSkin("name: x\nversion: 1\nparts:\n  callout:\n    description: d\n", base)).toThrow("adds settings to the catalog's own parts");
  });

  test("answers are cached per skin, and as before with none", () => {
    expect(Cache.key(inPaper, "post", "a tip")).toBe(JSON.stringify(["universal", base.version, "post", "a tip"]));
    expect(Cache.key(inBlowfish, "post", "a tip")).toBe(JSON.stringify(["universal", base.version, "skin:blowfish@1", "post", "a tip"]));
  });
});

describe("switching skins never breaks a page", () => {
  const page = "::: a tip -> callout icon=lightbulb\nRest here.\n:::\n\n::: an opening -> lead\nIt began.\n:::\n";

  test("in Blowfish, both draw, the icon with them", () => {
    const out = preprocess(page, inBlowfish);
    expect(out.content).toContain('{{< callout icon="lightbulb" >}}');
    expect(out.content).toContain("{{< lead >}}");
    expect(out.diagnostics).toEqual([]);
  });

  test("in another skin, the callout draws without the icon, which stays in the pin; the lead stays as text", () => {
    const out = preprocess(page, inPaper);
    expect(out.content).toContain("{{< callout >}}");
    expect(out.content).toContain("::: an opening -> lead");
    expect(out.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["other-skin", "icon comes with the blowfish skin; this site's theme leaves it out and keeps it in the pin"],
      ["other-skin", "lead comes with the blowfish skin; this site's theme doesn't draw it"],
    ]);
  });
});

describe("the look settings", () => {
  const noul = (n: number) => ({ type: "noul", noul: n }) as const;
  const choice = (probabilities: Record<string, number>) => {
    const [best] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!;
    return { type: "choice", choice: best, probabilities } as const;
  };

  test("are asked once a line, not once a part", () => {
    const ids = Object.keys(buildQuestions(inPaper));
    expect(ids.filter((id) => id.startsWith("look:")).sort()).toEqual(["look:border", "look:corners", "look:shadow", "look:text"]);
    expect(Object.keys(lookQuestions(inPaper))).toHaveLength(8);
  });

  test("a line asking for a shadow gets one, on whichever part it is", () => {
    const answers: Answers = {
      part: choice({ video: 0.95, figure: 0.05 }),
      "fits:video": noul(0.9), "said:video:width": noul(0.1), "setting:video:width": choice({ prose: 0.9, wide: 0.05, full: 0.05 }),
      "fits:figure": noul(0.2), "said:figure:width": noul(0.1), "setting:figure:width": choice({ prose: 0.9, wide: 0.05, full: 0.05 }),
      "look-said:shadow": noul(0.95), "look:shadow": choice({ none: 0.02, soft: 0.9, deep: 0.08 }),
      "look-said:border": noul(0.05), "look:border": choice({ none: 0.9, outlined: 0.1 }),
      "look-said:corners": noul(0.05), "look:corners": choice({ theme: 0.9, square: 0.05, round: 0.05 }),
      "look-said:text": noul(0.05), "look:text": choice({ normal: 0.9, smaller: 0.05, bigger: 0.05 }),
    } as unknown as Answers;
    const r = resolve(answers, inPaper);
    expect(r).toMatchObject({ outcome: "placed", candidates: [{ plain: "video shadow=soft" }] });
  });

  test("the second pass asks about them too, and they apply to the pin", () => {
    expect(Object.keys(refineQuestions(inPaper, "video"))).toContain("told:video:shadow");
    const next = applyRefine(parsePlain("video width=wide")!, { settings: { shadow: "deep", corners: "theme" }, unsettled: [], beyond: 0 }, inPaper);
    expect(next.settings).toEqual([{ key: "width", value: "wide" }, { key: "shadow", value: "deep" }]);
  });

  test("are the frame's too? No: the frame is not in the writing", () => {
    expect(Object.keys(settingsOf(inPaper, "header"))).not.toContain("shadow");
  });
});

describe("in the editor", () => {
  let dir: string;
  let ws: Workspace;
  const notes = new Map<string, Note[]>();
  const page = () => join(dir, "pages/posts/skin-test.md");
  const config = (theme: string) =>
    readFileSync(join(repo, "sites/blog/hugo.toml"), "utf8")
      .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
      .replace(/^theme = .*$/m, `theme = "universal"`)
      .replace(/^\[params\.rubric\][^[]*/m, "") + `\n[params.rubric]\ntheme = "${theme}"\n`;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rubric-skins-"));
    cpSync(join(repo, "sites/blog"), dir, { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
    writeFileSync(join(dir, "hugo.toml"), config("paper"));
    const site = await openSite(dir);
    ws = new Workspace(site, await Cache.load(site.cache), stubResolver(atPlace(site.catalog, "writing"), 5), (f, n) => notes.set(f, n), {
      idleMs: 5, waitMs: 1000, drawMs: 5,
    });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("switching the theme in hugo.toml brings its skin in without a restart", async () => {
    await ws.open(page(), "---\ntitle: T\n---\n::: a tip -> callout icon=lightbulb\nRest.\n:::\n");
    await ws.settle();
    expect(notes.get(page())?.map((n) => n.code)).toEqual(["other-skin"]);
    writeFileSync(join(dir, "hugo.toml"), config("blowfish"));
    await ws.reload(await openSite(dir));
    await ws.settle();
    expect(ws.site.skin).toBe("blowfish");
    expect(notes.get(page())).toEqual([]);
    expect(readFileSync(join(dir, "content/posts/skin-test.md"), "utf8")).toContain('{{< callout icon="lightbulb" >}}');
    expect(ws.complete(page(), 3, "::: a tip -> callout icon=lightbulb".length - "lightbulb".length).map((c) => c.label)).toContain("lightbulb");
  });

  test("in rubric.md, nothing fitting says the frame is all that goes there", async () => {
    const rubric = join(dir, "rubric.md");
    await ws.open(rubric, "::: a recipe card with ingredients\n:::\n");
    await ws.settle();
    expect(notes.get(rubric)?.find((n) => n.code === "nothing-fits")?.message).toBe(
      "nothing for the frame fits; rubric.md holds only what goes around every page, and parts for the writing go in a page",
    );
  });
});
