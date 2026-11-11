// The site's theme, chosen in rubric.md with `::: theme paper`: how the line
// is read, how it reaches the frame page and Hugo, the list the editor shows,
// and the theme being looked at in that list. A temporary copy of the blog
// site on the universal catalog, with the stub resolver.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atPlace, Cache, FRAME_PAGE, preprocess, scan, type PageKind } from "../src/core/index.ts";
import { stubResolver, stubThemeRanker } from "../src/server/stub.ts";
import { Workspace, type Note } from "../src/server/workspace.ts";
import { openSite, type Site } from "../src/site.ts";

const repo = join(import.meta.dir, "..");
const hugo = Bun.which("hugo");
let dir: string;
let site: Site;
let ws: Workspace;
const notes = new Map<string, Note[]>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rubric-themes-"));
  cpSync(join(repo, "sites/blog"), dir, { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  writeFileSync(join(dir, "hugo.toml"), readFileSync(join(dir, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  site = await openSite(dir);
  const stubs = { site: stubResolver(atPlace(site.catalog, "site"), 5), writing: stubResolver(atPlace(site.catalog, "writing"), 5) };
  const resolver = (d: string, p: PageKind) => stubs[p === "site" ? "site" : "writing"](d, p);
  ws = new Workspace(site, await Cache.load(site.cache), resolver, (f, n) => notes.set(f, n), { idleMs: 5, waitMs: 1000, drawMs: 5 });
});

// The last change's writes and the site opened again finish before the copy goes.
afterAll(async () => {
  await ws.settle();
  await Bun.sleep(100);
  ws.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const codes = (text: string, place: "site" | "writing" = "site") => preprocess(text, site.catalog, () => undefined, place).diagnostics.map((d) => d.code);

describe("the theme line", () => {
  test("names a theme, and may swap a piece", () => {
    const out = preprocess("::: theme hyde-red palette=dracula\n", site.catalog, () => undefined, "site");
    expect(out.theme).toEqual({ name: "hyde-red", palette: "dracula" });
    expect(out.entries[0]).toMatchObject({ kind: "theme", plain: "theme hyde-red palette=dracula", placed: true });
    expect(out.diagnostics).toEqual([]);
  });

  test("words in place of a name choose nothing yet, and say how to choose", () => {
    const out = preprocess("::: theme warm and bookish\n", site.catalog, () => undefined, "site");
    expect(out.theme).toBeUndefined();
    expect(out.diagnostics.map((d) => d.code)).toEqual(["theme-unpicked"]);
    expect(scan("::: theme warm and bookish\n", site.catalog).directives[0]!.theme).toEqual({ choice: {}, words: "warm and bookish" });
    expect(codes("::: theme\n")).toEqual(["theme-unpicked"]);
  });

  test("a piece that isn't there, a key that isn't a piece, a second line, and a theme in a page are each noted", () => {
    expect(codes("::: theme paper palette=nope\n")).toEqual(["value-not-allowed"]);
    expect(codes("::: theme paper font=big\n")).toEqual(["unknown-setting"]);
    // A piece named without its "=" yet is that setting, unfinished, and the
    // theme stays named.
    expect(codes("::: theme paper scale\n")).toEqual(["value-not-allowed"]);
    expect(scan("::: theme paper scale\n", site.catalog).directives[0]!.theme).toEqual({ choice: { name: "paper" } });
    // Among words, it's a word.
    expect(codes("::: theme large scale editorial\n")).toEqual(["theme-unpicked"]);
    expect(scan("::: theme large scale editorial\n", site.catalog).directives[0]!.theme!.words).toBe("large scale editorial");
    expect(codes("::: theme paper\n::: theme bear\n")).toEqual(["second-theme"]);
    expect(codes("::: theme paper\n", "writing")).toEqual(["wrong-place"]);
  });

  test("has no closing fence, so the block after it still closes", () => {
    const out = preprocess("::: theme paper\n\n::: header\n- [Posts](/posts/)\n:::\n", site.catalog, () => undefined, "site");
    expect(out.diagnostics).toEqual([]);
    expect(out.entries.map((e) => [e.kind, e.placed])).toEqual([["theme", true], ["plain", true]]);
  });

  test("a part named theme- is still a part", () => {
    expect(scan("::: theme-switch\n:::\n", site.catalog).directives[0]!.kind).toBe("plain");
  });
});

describe("rubric.md's theme", () => {
  const rubric = () => join(dir, "rubric.md");
  const framePage = () => JSON.parse(readFileSync(join(dir, "content", FRAME_PAGE), "utf8"));

  test("goes into the frame page, and the site is opened again in it", async () => {
    await ws.open(rubric(), "::: theme hyde-red\n\n::: header\n- [Posts](/posts/)\n:::\n");
    await ws.settle();
    expect(framePage().theme).toEqual({ name: "hyde-red" });
    await Bun.sleep(50);
    // So a skin that adds parts would add them; none in this catalog does.
    expect(ws.site.theme).toBe("hyde-red");
  });

  test("the theme looked at in the list is drawn until the list closes", async () => {
    await ws.previewTheme({ name: "dracula" });
    expect(framePage().theme).toEqual({ name: "dracula" });
    await ws.previewTheme(undefined);
    expect(framePage().theme).toEqual({ name: "hyde-red" });
  });

  test("choosing the theme looked at keeps it, with no step back to the old one", async () => {
    await ws.previewTheme({ name: "bear" });
    await ws.change(rubric(), "::: theme bear\n\n::: header\n- [Posts](/posts/)\n:::\n");
    await ws.settle();
    expect(framePage().theme).toEqual({ name: "bear" });
    // The look is the line's now: a later change to the line is drawn.
    await ws.change(rubric(), "::: theme paper\n\n::: header\n- [Posts](/posts/)\n:::\n");
    await ws.settle();
    expect(framePage().theme).toEqual({ name: "paper" });
  });

  test("without the line, hugo.toml's theme is back", async () => {
    await ws.change(rubric(), "::: header\n- [Posts](/posts/)\n:::\n");
    await ws.settle();
    expect(framePage().theme).toBeUndefined();
    await Bun.sleep(50);
    expect(ws.site.theme).toBe("paper");
  });
});

describe("the list", () => {
  test("has every theme with its colors, type and picture, and every piece", async () => {
    await ws.change(join(dir, "rubric.md"), "::: theme\n");
    const list = (await ws.themes(join(dir, "rubric.md"), 0))!;
    expect(list.themes.length).toBe(site.catalog.themes!.themes.length);
    const paper = list.themes.find((t) => t.name === "paper")!;
    expect(paper).toMatchObject({ palette: "paper", pairing: "source-serif", scale: "reading", scheme: "light" });
    expect(paper.colors.paper).toMatch(/^#[0-9a-f]{6}$/);
    expect(paper.picture && existsSync(paper.picture)).toBe(true);
    expect(list.palette.find((p) => p.name === "dracula")?.scheme).toBe("dark");
    expect(list.pairing.length).toBeGreaterThan(10);
    expect(list.current).toEqual({});
  });

  test("is put in order by the words on the line", async () => {
    await ws.change(join(dir, "rubric.md"), "::: theme solarized cream\n");
    const list = (await ws.themes(join(dir, "rubric.md"), 0, stubThemeRanker))!;
    expect(list.ranked).toBe("solarized cream");
    expect(list.themes[0]!.name).toBe("solarized-light");
  });

  test("every theme has its picture", () => {
    const missing = site.catalog.themes!.themes.filter((t) => !existsSync(join(site.themeDir, "previews", `${t}.png`)));
    expect(missing).toEqual([]);
  });

  test("completion offers the themes and the pieces, for an editor with no list", async () => {
    const rubric = join(dir, "rubric.md");
    await ws.change(rubric, "::: theme hyde-r\n");
    expect(ws.complete(rubric, 0, "::: theme hyde-r".length).map((c) => c.label)).toEqual(["hyde-red"]);
    await ws.change(rubric, "::: theme paper pal\n");
    expect(ws.complete(rubric, 0, "::: theme paper pal".length).map((c) => c.newText)).toEqual(["palette="]);
    await ws.change(rubric, "::: theme paper palette=drac\n");
    expect(ws.complete(rubric, 0, "::: theme paper palette=drac".length).map((c) => c.newText)).toEqual(["dracula"]);
    await ws.change(rubric, "::: th\n");
    expect(ws.complete(rubric, 0, "::: th".length).map((c) => c.label)).toEqual(["theme", "theme-switch"]);
  });
});

test.skipIf(!hugo)("Hugo draws the theme the frame page names, before hugo.toml's", () => {
  const s = mkdtempSync(join(tmpdir(), "rubric-hugo-theme-"));
  try {
    writeFileSync(join(s, "hugo.toml"), readFileSync(join(repo, "testing/hugo.toml"), "utf8")
      .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
      .replace(/^theme = "(?!universal).*"$/m, `theme = "paper"`));
    mkdirSync(join(s, "content/posts"), { recursive: true });
    mkdirSync(join(s, "content/rubric-frame"), { recursive: true });
    writeFileSync(join(s, "content/posts/p.md"), "---\ntitle: P\n---\n\nWords.\n");
    const build = (theme?: object) => {
      writeFileSync(join(s, "content/rubric-frame/index.md"), JSON.stringify({ title: "frame", build: { render: "never", list: "never" }, frame: [], ...(theme ? { theme } : {}) }));
      const r = Bun.spawnSync([hugo!, "--quiet", "-s", s, "-d", join(s, "public")]);
      expect(r.stderr.toString()).toBe("");
      return readFileSync(join(s, "public/posts/p/index.html"), "utf8");
    };
    expect(build()).toContain("css/paper-source-serif-reading-");
    expect(build({ name: "hyde-red" })).toContain("css/hyde-red-pt-abril-hyde-");
    expect(build({ name: "hyde-red", palette: "dracula" })).toContain("css/dracula-pt-abril-hyde-");
    // A swap alone is made to hugo.toml's theme.
    expect(build({ palette: "dracula" })).toContain("css/dracula-source-serif-reading-");
  } finally {
    rmSync(s, { recursive: true, force: true });
  }
});
