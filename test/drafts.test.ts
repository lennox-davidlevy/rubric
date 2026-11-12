// New parts, drafted for a `::: new:` line (docs/plan.md, step 7): offered
// when nothing fits, drafted only when asked, checked, drawn in place, then
// kept for the site or the catalog, rerolled, or cancelled. A temporary copy
// of the testing site on a temporary copy of the universal catalog, with the
// stub resolver and the stub harness.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atPlace, Cache, scan, type PageKind } from "../src/core/index.ts";
import { DRAFT_INDEX, DRAFT_LOGS, DRAFTS, HUGO_TREE, readDrafts, shownTake } from "../src/parts.ts";
import { checkDraft } from "../src/server/draft.ts";
import { stubHarness, stubResolver } from "../src/server/stub.ts";
import { Workspace, type Note } from "../src/server/workspace.ts";
import { openSite } from "../src/site.ts";

const repo = join(import.meta.dir, "..");
const hugo = Bun.which("hugo");
let tmp: string;
let dir: string;
let catalogDir: string;
let ws: Workspace;
let asked: string[];
// The model chosen for each draft alone, or "default", in order.
let uses: string[] = [];
// The conversation each run was asked to go on with, in order.
let resumes: (string | undefined)[] = [];
let sessions = 0;
const notes = new Map<string, Note[]>();
const page = () => join(dir, "pages/posts/new.md");
const front = "---\ntitle: New\n---\n\n";

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "rubric-drafts-"));
  catalogDir = join(tmp, "catalogs/universal");
  cpSync(join(repo, "catalogs/universal"), catalogDir, { recursive: true, filter: (src) => !/\/universal\/(shots|previews)(\/|$)|\/page\/(public|resources)(\/|$)/.test(src) });
  dir = join(tmp, "site");
  cpSync(join(repo, "testing"), dir, { recursive: true, filter: (src) => !/\/(content|\.rubric|public|resources)(\/|$)/.test(src) });
  writeFileSync(join(dir, "hugo.toml"), readFileSync(join(dir, "hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(tmp, "catalogs"))}`));
  ws = await workspace();
});

async function workspace(): Promise<Workspace> {
  const site = await openSite(dir);
  asked = [];
  const current = () => ws?.site ?? site;
  const resolver = (d: string, p: PageKind) => {
    asked.push(d);
    return stubResolver(atPlace(current().catalog, p === "site" ? "site" : "writing"), 5)(d, p);
  };
  return new Workspace(site, await Cache.load(site.cache), resolver, (f, n) => notes.set(f, n), {
    idleMs: 5, waitMs: 1000, drawMs: 5,
    harness: async (d, prompt, signal, log, use, resume) => {
      uses.push(use?.model ?? "default");
      resumes.push(resume?.id);
      const r = await stubHarness(current().catalog, 5)(d, prompt, signal, log);
      // What a tool reports: its cost and a conversation to go on with.
      return { ...r, resumed: resume !== undefined, stats: { turns: 2, cost: 0.1, thinking: 50 }, session: { id: `s-${++sessions}`, harness: "claude" as const, model: "sonnet", cwd: "/nowhere" }, drafter: { harness: "claude" as const, model: "sonnet", effort: "low" } };
    },
  });
}

afterAll(async () => {
  await ws.drafted();
  await Bun.sleep(100);
  ws.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

async function write(text: string): Promise<void> {
  writeFileSync(page(), text);
  await ws.change(page(), text);
  await ws.settle();
}

const codes = (line: number) => (notes.get(page()) ?? []).filter((n) => n.line === line).map((n) => n.code);
const content = () => readFileSync(join(dir, "content/posts/new.md"), "utf8");
const draftsOnDisk = () => (existsSync(join(dir, DRAFTS)) ? readdirSync(join(dir, DRAFTS)) : []);

describe("the line", () => {
  test("`new:` asks for a part, opens a block, and is never sent to Jev", async () => {
    const s = scan(`${front}::: new: a timeline of posts by year\n:::\n`, ws.site.catalog);
    expect(s.directives.map((d) => [d.kind, d.words, d.close])).toEqual([["new", "a timeline of posts by year", 5]]);
    await write(`${front}::: new: a timeline of posts by year\n:::\n`);
    expect(asked).not.toContain("a timeline of posts by year");
    expect(asked).not.toContain("new: a timeline of posts by year");
    expect(codes(4)).toEqual(["new-part"]);
    // Nothing is drafted until the writer asks.
    expect(draftsOnDisk()).toEqual([]);
  });

  test("words nothing fits offer a new part, which turns the line into `new:`", async () => {
    await write(`${front}::: a wobbly orbit of moons\n:::\n`);
    const ghosts = await ws.ghost(page(), 4);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.build).toBe(true);
    expect(ghosts[0]!.replace).toBe("::: new: a wobbly orbit of moons");
  });

  test("rubric.md gets no such offer: a new part goes in the writing", async () => {
    const rubric = join(dir, "rubric.md");
    const text = "::: a wobbly orbit of moons\n:::\n";
    await ws.open(rubric, text);
    await ws.settle();
    expect(await ws.ghost(rubric, 0)).toEqual([]);
    await ws.close(rubric);
  });
});

describe("a draft", () => {
  test("is drafted when asked, then drawn where its line is, in the preview only", async () => {
    await write(`${front}Before.\n\n::: new: moon orbit\nThree moons.\n:::\n\nAfter.\n`);
    const started = await ws.build(page(), 6);
    expect(started?.status).toBe("drafting");
    await ws.settle();
    expect(codes(6)).toEqual(["drafting"]);
    await ws.drafted();
    expect(ws.draft(page(), 6)).toMatchObject({ status: "ready", name: "moon-orbit" });
    expect(codes(6)).toEqual(["draft-ready"]);
    expect(content()).toContain("{{< moon-orbit >}}");
    // Hugo sees it beside the catalog; Jev never does.
    expect(existsSync(join(dir, HUGO_TREE, "layouts/_partials/parts/moon-orbit.html"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, HUGO_TREE, "data/siteparts.json"), "utf8"))).toHaveProperty("moon-orbit");
    expect(ws.site.catalog.parts["moon-orbit"]?.origin).toBe("draft");
    expect(atPlace(ws.site.catalog, "writing").parts).not.toHaveProperty("moon-orbit");
    // Its log, where the editor can open it, tells what the tool did and how it ended, in order.
    const log = ws.draft(page(), 6)!.log!;
    const lines = readFileSync(log, "utf8").trim().split("\n");
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at("brief.md")).toBeGreaterThan(0);
    expect(at("part.css")).toBeGreaterThan(at("brief.md"));
    expect(lines.at(-1)).toContain("moon-orbit");
    expect(lines.every((l) => /^(\d+:\d\d|\s)/.test(l))).toBe(true);
  });

  test.skipIf(!hugo)("Hugo draws the page with the draft in it", () => {
    const out = join(tmp, "public");
    const r = Bun.spawnSync([hugo!, "--quiet", "-s", dir, "-d", out], { stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    const html = readFileSync(join(out, "posts/new/index.html"), "utf8");
    expect(html).toMatch(/class="part part-moon-orbit[ "]/);
    expect(html).toContain("Three moons.");
    rmSync(out, { recursive: true, force: true });
  });

  test("a reroll adds a take and puts it on screen; the takes before it stay, to cycle back to", async () => {
    const before = draftsOnDisk();
    await ws.build(page(), 6, { change: "make the moons bigger" });
    // The draft shown stays while the next is made.
    expect(content()).toContain("{{< moon-orbit >}}");
    await ws.drafted();
    const after = draftsOnDisk();
    expect(after).toHaveLength(2);
    const added = after.find((d) => !before.includes(d))!;
    expect(readFileSync(join(dir, DRAFTS, added, "part.html"), "utf8")).toContain("make the moons bigger");
    // It was asked of the take before, whose files its brief shows.
    const first = readFileSync(join(dir, DRAFTS, before[0]!, "part.html"), "utf8").trim();
    expect(readFileSync(join(dir, DRAFTS, added, "brief.md"), "utf8")).toContain(first);
    expect(ws.draft(page(), 6)).toMatchObject({ take: 2, takes: 2 });
    // What Hugo draws is the take on screen.
    const drawn = () => readFileSync(join(dir, HUGO_TREE, "layouts/_partials/parts/moon-orbit.html"), "utf8");
    expect(drawn()).toContain("make the moons bigger");
    // Back to the first, and round to the second again.
    expect(await ws.take(page(), 6, -1)).toMatchObject({ take: 1, takes: 2 });
    expect(drawn()).not.toContain("make the moons bigger");
    expect(await ws.take(page(), 6, -1)).toMatchObject({ take: 2 });
    // The choice is on disk, so a server started again shows the same take.
    await ws.take(page(), 6, 1);
    expect(ws.draft(page(), 6)).toMatchObject({ take: 1 });
    expect(shownTake(readDrafts(dir), "moon orbit")?.id).toBe(before[0]);
    // A reroll with words starts from the take on screen.
    await ws.build(page(), 6, { change: "only two moons" });
    await ws.drafted();
    const third = draftsOnDisk().find((d) => !after.includes(d))!;
    expect(readFileSync(join(dir, DRAFTS, third, "brief.md"), "utf8")).not.toContain("make the moons bigger");
    expect(ws.draft(page(), 6)).toMatchObject({ take: 3, takes: 3 });
  });

  test("one the checks refuse goes back with the reasons, and is fixed", async () => {
    await write(`${front}::: new: broken gauge\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    expect(ws.draft(page(), 4)).toMatchObject({ status: "ready", name: "gauge" });
    const id = draftsOnDisk().find((d) => d.startsWith("broken-gauge"))!;
    expect(readFileSync(join(dir, DRAFTS, id, "part.css"), "utf8")).not.toMatch(/#[0-9a-f]{3,6}/);
  });

  test("a harness that fails says so on the line", async () => {
    await write(`${front}::: new: failing widget\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    expect(ws.draft(page(), 4)?.status).toBe("failed");
    expect(codes(4)).toEqual(["draft-failed"]);
    expect(content()).not.toMatch(/\{\{< (?!rubric-line)/);
  });

  test("words the catalog already has a part for say which, and can use it", async () => {
    await write(`${front}::: new: a quote from my aunt\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    expect(ws.draft(page(), 4)).toMatchObject({ status: "exists", name: "quote" });
    expect(codes(4)).toEqual(["draft-exists"]);
    expect((await ws.use(page(), 4)).replace).toBe("::: quote");
  });

  test("cancel takes every draft for the line away and gives the words back", async () => {
    await write(`${front}::: new: slow comet trail\n:::\n`);
    await ws.build(page(), 4);
    const done = await ws.cancel(page(), 4);
    expect(done.replace).toBe("::: slow comet trail");
    await ws.drafted();
    expect(draftsOnDisk().filter((d) => d.startsWith("slow-comet"))).toEqual([]);
    // It's kept in the drafts' log, whole, with what became of it, to look back on.
    const index = readFileSync(join(dir, DRAFT_INDEX), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const entry = index.find((e) => e.words === "slow comet trail");
    expect(entry).toMatchObject({ outcome: "cancelled" });
    expect(existsSync(join(dir, DRAFT_LOGS, entry.id, "draft.log"))).toBe(true);
    expect(existsSync(join(dir, DRAFT_LOGS, entry.id, "brief.md"))).toBe(true);
  });

  test("takes cancelled before come back for the same words, instead of drafting again", async () => {
    await write(`${front}::: new: folded cranes\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    await ws.build(page(), 4, { change: "" });
    await ws.drafted();
    expect(ws.draft(page(), 4)).toMatchObject({ takes: 2 });
    await ws.cancel(page(), 4);
    // Typed again later: nothing drafted, two to bring back.
    await write(`${front}::: new: folded cranes\n:::\n`);
    expect(ws.draft(page(), 4)).toMatchObject({ earlier: 2 });
    expect(ws.draft(page(), 4)?.status).toBeUndefined();
    expect(await ws.restore(page(), 4)).toMatchObject({ status: "ready", takes: 2 });
    expect(draftsOnDisk().filter((d) => d.startsWith("folded-cranes"))).toHaveLength(2);
    await ws.settle();
    expect(content()).toContain("{{< folded-cranes >}}");
    // Kept: the take on screen is kept, and the other goes to the record.
    await ws.keep(page(), 4, false);
    const index = readFileSync(join(dir, DRAFT_INDEX), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = index.filter((e) => e.words === "folded cranes").slice(-2).map((e) => e.outcome).sort();
    expect(last).toEqual(["another take was kept", "kept for the site"]);
    // Kept takes, and the ones dropped beside them, are never offered back.
    await write(`${front}::: new: folded cranes\n:::\n`);
    expect(ws.draft(page(), 4)?.earlier).toBeUndefined();
  });

  test("stop ends only the draft being made: the one before it stays to keep, and the line stays", async () => {
    await write(`${front}::: new: slow tide ribbon\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    const first = draftsOnDisk().filter((d) => d.startsWith("slow-tide"));
    expect(first).toHaveLength(1);
    await ws.build(page(), 4, { change: "taller" });
    expect(ws.draft(page(), 4)?.status).toBe("drafting");
    const done = await ws.stop(page(), 4);
    expect(done.replace).toBeUndefined();
    expect(draftsOnDisk().filter((d) => d.startsWith("slow-tide"))).toEqual(first);
    expect(ws.draft(page(), 4)).toMatchObject({ status: "ready", name: "tide-ribbon" });
    await ws.settle();
    expect(codes(4)).toEqual(["draft-ready"]);
    expect(content()).toContain("{{< tide-ribbon >}}");

    // With nothing made before it, the line is back to no draft at all.
    await ws.cancel(page(), 4);
    await write(`${front}::: new: slow tide ribbon\n:::\n`);
    await ws.build(page(), 4);
    await ws.stop(page(), 4);
    expect(draftsOnDisk().filter((d) => d.startsWith("slow-tide"))).toEqual([]);
    expect(ws.draft(page(), 4)?.status).toBeUndefined();
  });

  test("a draft stays until the writer cancels, keeps or uses it, even with its line unsaved when a server starts", async () => {
    await write(`${front}::: new: lantern parade\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    // The line was never saved: the file on disk doesn't have it.
    writeFileSync(page(), `${front}Saved without it.\n`);
    const other = await workspace();
    await other.buildAll();
    await other.settle();
    expect(draftsOnDisk().some((d) => d.startsWith("lantern-parade"))).toBe(true);
    other.dispose();
    await write(`${front}::: new: lantern parade\n:::\n`);
    await ws.cancel(page(), 4);
    expect(draftsOnDisk().filter((d) => d.startsWith("lantern-parade"))).toEqual([]);
  });
});

test("an empty block's part starter is sent to the editor, and goes once the block has words", async () => {
  await write(`${front}::: hero\n\n:::\n\n::: hero\n# Mine\n:::\n`);
  const starters = ws.starters(page());
  expect(starters).toHaveLength(1);
  expect(starters[0]).toMatchObject({ line: 4, close: 6, part: "hero" });
  expect(starters[0]!.body.join("\n")).toBe(ws.site.catalog.parts.hero!.body!.replace(/\n+$/, ""));
  await write(`${front}::: hero\n# Mine too\n:::\n`);
  expect(ws.starters(page())).toEqual([]);
});

describe("keeping it", () => {
  test("for this site: its files in parts/, the line becomes the part, and Jev may pick it", async () => {
    await write(`${front}::: new: moon phases\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    const key = Cache.key(atPlace(ws.site.catalog, "writing"), "post", "x");
    const done = await ws.keep(page(), 4, false);
    expect(done.replace).toBe("::: moon-phases");
    expect(done.part).toEqual({ name: "moon-phases", settings: [{ name: "pace", values: ["slow", "fast"] }] });
    expect(readdirSync(join(dir, "parts/moon-phases")).sort()).toEqual(["part.css", "part.html", "part.yaml"]);
    expect(draftsOnDisk().filter((d) => d.startsWith("moon-phases"))).toEqual([]);
    expect(ws.site.catalog.parts["moon-phases"]?.origin).toBe("site");
    expect(atPlace(ws.site.catalog, "writing").parts).toHaveProperty("moon-phases");
    // Jev reads the site's parts, so every line is asked again with them.
    expect(Cache.key(atPlace(ws.site.catalog, "writing"), "post", "x")).not.toBe(key);
    await write(`${front}::: moon-phases\nWaxing.\n:::\n`);
    expect(content()).toContain("{{< moon-phases >}}");
    expect(codes(4)).toEqual([]);
    // The server knows it now as it knows the catalog's own: by name, its
    // settings, their values, and a value it doesn't have.
    expect(ws.complete(page(), 4, 8).map((c) => c.label)).toContain("moon-phases");
    await write(`${front}::: moon-phases pace=\nWaxing.\n:::\n`);
    expect(ws.complete(page(), 4, 23).map((c) => c.label).sort()).toEqual(["fast", "slow"]);
    await write(`${front}::: moon-phases pace=sideways\nWaxing.\n:::\n`);
    expect(codes(4)).toEqual(["value-not-allowed"]);
    await write(`${front}::: moon-phases pace=fast\nWaxing.\n:::\n`);
    expect(content()).toContain(`{{< moon-phases pace="fast" >}}`);
  });

  test("a server started later reads the site's parts", async () => {
    const site = await openSite(dir);
    expect(site.catalog.parts["moon-phases"]?.origin).toBe("site");
    expect(site.ownProblems).toEqual([]);
  });

  test("for every theme: into the catalog, with the version bumped", async () => {
    const version = ws.site.catalog.version;
    await write(`${front}::: new: tide clock\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    const done = await ws.keep(page(), 4, true);
    expect(done).toMatchObject({ replace: "::: tide-clock", version: version + 1 });
    expect(ws.site.catalog.version).toBe(version + 1);
    expect(ws.site.catalog.parts["tide-clock"]?.origin).toBeUndefined();
    for (const f of ["layouts/_shortcodes/tide-clock.html", "layouts/_partials/parts/tide-clock.html", "assets/css/parts/tide-clock.css"]) {
      expect(existsSync(join(catalogDir, f))).toBe(true);
    }
    expect(existsSync(join(dir, "parts/tide-clock"))).toBe(false);
  });

  test("one Hugo can't build goes nowhere, and the catalog is as it was", async () => {
    const before = readFileSync(join(catalogDir, "catalog.yaml"), "utf8");
    const bad = join(tmp, "bad");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "part.yaml"), "name: bad-one\ndescription: A part that does not draw.\nchildren: true\n");
    writeFileSync(join(bad, "part.html"), `<div class="part part-bad-one">{{ partial "nothing-here.html" . }}</div>\n`);
    writeFileSync(join(bad, "part.css"), ".part-bad-one { color: var(--ink); }\n");
    const { makeGlobal } = await import("../src/parts.ts");
    await expect(makeGlobal(catalogDir, bad, "bad-one")).rejects.toThrow();
    expect(readFileSync(join(catalogDir, "catalog.yaml"), "utf8")).toBe(before);
    expect(existsSync(join(catalogDir, "layouts/_partials/parts/bad-one.html"))).toBe(false);
  });
});

describe("the checks", () => {
  test("refuse a literal color, a script, a taken name and a wrong outer class", async () => {
    const d = join(tmp, "check");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "part.yaml"), "name: quote\ndescription: Another quote.\nchildren: true\n");
    writeFileSync(join(d, "part.html"), `<div class="quote-box"><script>alert(1)</script>{{ .inner }}</div>\n`);
    writeFileSync(join(d, "part.css"), ".part-quote { color: #333; }\n");
    const { problems } = await checkDraft(ws.site, d);
    expect(problems.some((p) => p.includes("already a part"))).toBe(true);
    expect(problems.some((p) => p.includes("literal color"))).toBe(true);
    expect(problems.some((p) => p.includes("no scripts"))).toBe(true);
    expect(problems.some((p) => p.includes("outer element"))).toBe(true);
  });

  test("take a custom property the HTML sets inline as the part's own, and refuse one set nowhere", async () => {
    const d = join(tmp, "check-inline");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "part.yaml"), "name: orbiters\ndescription: Things in orbit.\nchildren: true\n");
    writeFileSync(join(d, "part.html"), `<div class="part part-orbiters"><span style="--angle: 40deg"></span>{{ .inner }}</div>\n`);
    writeFileSync(join(d, "part.css"), ".part-orbiters span { rotate: var(--angle); color: var(--ink); }\n");
    expect((await checkDraft(ws.site, d)).problems).toEqual([]);
    writeFileSync(join(d, "part.css"), ".part-orbiters span { rotate: var(--angle); translate: var(--reach); }\n");
    const { problems } = await checkDraft(ws.site, d);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("--reach");
  });
});

test("a site whose hugo.toml doesn't mount .rubric/hugo/ says so, and offers no new part", async () => {
  const blog = join(tmp, "blog");
  cpSync(join(repo, "sites/blog"), blog, { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  writeFileSync(join(blog, "hugo.toml"), readFileSync(join(blog, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(tmp, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const site = await openSite(blog);
  expect(site.ownMounted).toBe(false);
  const seen = new Map<string, Note[]>();
  const other = new Workspace(site, new Cache(), stubResolver(atPlace(site.catalog, "writing"), 5), (f, n) => seen.set(f, n), {
    idleMs: 5, waitMs: 1000, drawMs: 5, harness: stubHarness(site.catalog, 5),
  });
  const file = join(blog, "pages/posts/new.md");
  const text = `${front}::: a wobbly orbit of moons\n:::\n\n::: new: moon orbit\n:::\n`;
  writeFileSync(file, text);
  await other.open(file, text);
  await other.settle();
  expect(await other.ghost(file, 4)).toEqual([]);
  expect(seen.get(file)!.filter((n) => n.line === 7).map((n) => [n.code, n.severity])).toEqual([["new-part", "warning"]]);
  await other.build(file, 7);
  await other.drafted();
  expect(other.draft(file, 7)?.status).toBe("failed");
  other.dispose();
});

describe("in a hurry", () => {
  test("two requests for the same line start one draft", async () => {
    await write(`${front}::: new: twin lanterns\n:::\n`);
    const [a, b] = await Promise.all([ws.build(page(), 4), ws.build(page(), 4)]);
    expect([a?.status, b?.status]).toEqual(["drafting", "drafting"]);
    await ws.drafted();
    expect(draftsOnDisk().filter((d) => d.startsWith("twin-lanterns"))).toHaveLength(1);
    await ws.cancel(page(), 4);
  });

  test("cancel straight after asking leaves nothing behind", async () => {
    await write(`${front}::: new: quick lanterns\n:::\n`);
    const started = ws.build(page(), 4);
    const done = await ws.cancel(page(), 4);
    await started;
    await ws.drafted();
    expect(done.replace).toBe("::: quick lanterns");
    expect(draftsOnDisk().filter((d) => d.startsWith("quick-lanterns"))).toEqual([]);
  });

  test("keep keeps the take on screen, by its own name, when an older take is on screen", async () => {
    await write(`${front}::: new: silver bells\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    await ws.build(page(), 4, { change: "name it chimes" });
    await ws.drafted();
    expect(ws.draft(page(), 4)).toMatchObject({ name: "chimes", take: 2 });
    expect(await ws.take(page(), 4, -1)).toMatchObject({ name: "silver-bells", take: 1 });
    await ws.settle();
    expect(codes(4)).toEqual(["draft-ready"]);
    expect(content()).toContain("{{< silver-bells >}}");
    const done = await ws.keep(page(), 4, false);
    expect(done.replace).toBe("::: silver-bells");
    expect(existsSync(join(dir, "parts/silver-bells/part.yaml"))).toBe(true);
    expect(existsSync(join(dir, "parts/chimes"))).toBe(false);
  });

  test("a name another line's take has is refused, even when that take isn't on screen", async () => {
    await write(`${front}::: new: brass horns\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    await ws.build(page(), 4, { change: "name it trumpets" });
    await ws.drafted();
    await ws.take(page(), 4, -1);
    // Other words, asking for the hidden take's name.
    const { checkDraft } = await import("../src/server/draft.ts");
    const other = join(tmp, "other-draft");
    rmSync(other, { recursive: true, force: true });
    cpSync(join(dir, DRAFTS, draftsOnDisk().find((d) => readFileSync(join(dir, DRAFTS, d, "part.yaml"), "utf8").includes("name: trumpets"))!), other, { recursive: true });
    const { problems } = await checkDraft(ws.site, other, "some other words");
    expect(problems.some((p) => p.includes("trumpets"))).toBe(true);
    rmSync(other, { recursive: true, force: true });
    await ws.cancel(page(), 4);
  });

  test("keep while a reroll is being made keeps the draft shown, and stops the reroll", async () => {
    await write(`${front}::: new: paper lanterns\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    await ws.build(page(), 4, { change: "slow down" });
    const done = await ws.keep(page(), 4, false);
    expect(done.replace).toBe("::: paper-lanterns");
    await ws.drafted();
    expect(draftsOnDisk().filter((d) => d.startsWith("paper-lanterns"))).toEqual([]);
    expect(existsSync(join(dir, "parts/paper-lanterns/part.yaml"))).toBe(true);
  });
});

test("a draft's name on any other line is not a part until it is kept", async () => {
  await write(`${front}::: new: moon lanterns\n:::\n\n::: moon-lanterns\n:::\n`);
  await ws.build(page(), 4);
  await ws.drafted();
  expect(ws.draft(page(), 4)?.status).toBe("ready");
  expect(codes(7)).toEqual(["unknown-part"]);
  expect(content()).toContain("{{< moon-lanterns >}}");
  expect(content().match(/\{\{< moon-lanterns >\}\}/g)).toHaveLength(1);
  await ws.cancel(page(), 4);
});

test("using a catalog part that takes nothing inside takes the block's closer away", async () => {
  await write(`${front}::: new: a divider here\n:::\n`);
  await ws.build(page(), 4);
  await ws.drafted();
  expect(await ws.use(page(), 4)).toEqual({ replace: "::: divider", drop: 5 });
});

test("the folders Hugo mounts are there before any part is, so a Hugo started first sees parts added later", async () => {
  const root = join(tmp, "empty-site");
  const { writeHugoTree } = await import("../src/parts.ts");
  await writeHugoTree(root, {});
  for (const d of ["layouts/_shortcodes", "layouts/_partials/parts", "assets/css/parts", "data"]) {
    expect(existsSync(join(root, HUGO_TREE, d))).toBe(true);
  }
});

test("the brief shows each curated example's own files, and what it is there to teach", async () => {
  const { brief, EXAMPLES } = await import("../src/server/draft.ts");
  const text = brief(ws.site, { words: "trail markers", inside: "" });
  for (const [name, why] of EXAMPLES) {
    expect(text).toContain(`### ${name}\n${why}`);
    const html = readFileSync(join(ws.site.themeDir, "layouts/_partials/parts", `${name}.html`), "utf8").trim();
    expect(text).toContain(html);
  }
});

describe("another take of the site's own part", () => {
  const partFile = (f: string) => readFileSync(join(dir, "parts/harbor-lights", f), "utf8");
  const drawn = () => readFileSync(join(dir, HUGO_TREE, "layouts/_partials/parts/harbor-lights.html"), "utf8");
  const index = () => readFileSync(join(dir, DRAFT_INDEX), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { of?: string; outcome: string; status: string });
  const ofHarbor = () => draftsOnDisk().filter((d) => d.startsWith("harbor-lights"));
  const twoBlocks = `${front}::: harbor-lights\nThe pier.\n:::\n\n::: harbor-lights\nThe bay.\n:::\n`;

  beforeAll(async () => {
    await write(`${front}::: new: harbor lights\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    await ws.keep(page(), 4, false);
    await write(twoBlocks);
  });

  test("its lines are known, and say how many other blocks use it", async () => {
    expect(ws.ownLines(page()).map((o) => [o.line, o.part])).toEqual([[4, "harbor-lights"], [8, "harbor-lights"]]);
    expect(await ws.look(page(), 4)).toMatchObject({ of: "harbor-lights", uses: { blocks: 1, pages: 1 } });
    expect(ws.draft(page(), 4)?.status).toBeUndefined();
    // A catalog part's line is not one.
    await write(`${front}::: quote\nSaid.\n:::\n`);
    expect(await ws.look(page(), 4)).toBeUndefined();
    await write(twoBlocks);
  });

  test("rerolls under the same name, drawn in the preview for every block, with the kept one as the first take", async () => {
    const kept = partFile("part.html");
    await ws.build(page(), 4, { change: "brighter" });
    await ws.settle();
    expect(codes(4)).toEqual(["drafting"]);
    // The kept part is drawn while it drafts.
    expect(drawn()).toBe(kept);
    await ws.drafted();
    expect(ws.draft(page(), 4)).toMatchObject({ status: "ready", name: "harbor-lights", of: "harbor-lights", take: 2, takes: 2 });
    expect(codes(4)).toEqual(["draft-ready"]);
    expect(codes(8)).toEqual(["draft-ready"]);
    expect(drawn()).toContain(`data-change="brighter"`);
    expect(content().match(/\{\{< harbor-lights >\}\}/g)).toHaveLength(2);
    // Not kept yet: the site's files are as they were.
    expect(partFile("part.html")).toBe(kept);
    expect(ws.ownLines(page())[0]!.takes).toBe(2);
    // Back to the kept one, and forward again.
    expect(await ws.take(page(), 4, -1)).toMatchObject({ take: 1 });
    expect(drawn()).toBe(kept);
    await ws.take(page(), 4, 1);
    expect(drawn()).toContain(`data-change="brighter"`);
  });

  test("keeping a take writes it over the site's part; the line stays", async () => {
    const done = await ws.keep(page(), 4, false);
    expect(done.error).toBeUndefined();
    expect(done.replace).toBeUndefined();
    expect(done.part?.name).toBe("harbor-lights");
    expect(partFile("part.html")).toContain(`data-change="brighter"`);
    expect(ofHarbor()).toEqual([]);
    expect(ws.site.catalog.parts["harbor-lights"]?.origin).toBe("site");
    // The record has both: the take kept, and the part as it was, which wasn't.
    expect(index().filter((e) => e.of === "harbor-lights").map((e) => e.outcome).sort()).toEqual(["another take was kept", "kept for the site"]);
    await ws.settle();
    expect(codes(4)).toEqual([]);
  });

  test("going back leaves the site's part as it was", async () => {
    const kept = partFile("part.html");
    await ws.build(page(), 4, { change: "dimmer" });
    await ws.drafted();
    expect(drawn()).toContain(`data-change="dimmer"`);
    expect(await ws.cancel(page(), 4)).toEqual({});
    expect(partFile("part.html")).toBe(kept);
    expect(drawn()).toBe(kept);
    expect(ofHarbor()).toEqual([]);
  });

  test("stopping the only other take is the part again, with nothing left over", async () => {
    await ws.build(page(), 4, { change: "" });
    expect(ws.draft(page(), 4)?.status).toBe("drafting");
    await ws.stop(page(), 4);
    await ws.drafted();
    expect(ws.draft(page(), 4)?.status).toBeUndefined();
    expect(ofHarbor()).toEqual([]);
  });

  test("a take that renames it is refused: pages use it by its name", async () => {
    await ws.build(page(), 4, { change: "name it beacons" });
    await ws.drafted();
    const view = ws.draft(page(), 4)!;
    expect(view.status).toBe("failed");
    expect(view.message).toContain("harbor-lights");
    expect(ws.site.catalog.parts.beacons).toBeUndefined();
    await ws.cancel(page(), 4);
  });

  test("a take without a setting the line sets is still the part's take, to keep, cycle or go back from", async () => {
    await write(twoBlocks.replace("::: harbor-lights\nThe pier.", "::: harbor-lights pace=fast\nThe pier."));
    await ws.build(page(), 4, { change: "no settings" });
    await ws.drafted();
    expect(ws.site.catalog.parts["harbor-lights"]?.settings).not.toHaveProperty("pace");
    expect(ws.draft(page(), 4)).toMatchObject({ status: "ready", of: "harbor-lights", take: 2, takes: 2 });
    expect(ws.ownLines(page()).map((o) => o.line)).toEqual([4, 8]);
    await ws.settle();
    expect(codes(4)).toContain("draft-ready");
    expect(await ws.take(page(), 4, -1)).toMatchObject({ take: 1 });
    expect(ws.site.catalog.parts["harbor-lights"]?.settings).toHaveProperty("pace");
    await ws.cancel(page(), 4);
    await write(twoBlocks);
  });

  test("words after its \":\" are a reroll's change, not a question for Jev", async () => {
    await write(twoBlocks.replace("::: harbor-lights\nThe pier.", `::: harbor-lights title="a : b" : brighter\nThe pier.`));
    expect(await ws.ghost(page(), 4)).toEqual([]);
    expect(ws.draft(page(), 4)?.change).toEqual({ words: "brighter", colon: `::: harbor-lights title="a : b" `.length });
    await write(twoBlocks);
  });

  test("removing it puts its files in the record, and its lines are no longer drawn as it", async () => {
    const done = await ws.remove(page(), 4);
    expect(done.error).toBeUndefined();
    expect(existsSync(join(dir, "parts/harbor-lights"))).toBe(false);
    expect(existsSync(join(dir, done.removed!, "part.yaml"))).toBe(true);
    expect(ws.site.catalog.parts["harbor-lights"]).toBeUndefined();
    await ws.settle();
    expect(content()).not.toContain("{{< harbor-lights");
    expect(ws.ownLines(page())).toEqual([]);
    // A catalog part's line can't be removed.
    await write(`${front}::: quote\nSaid.\n:::\n`);
    expect((await ws.remove(page(), 4)).error).toBeDefined();
  });

  test("made available to every theme: into the catalog, and out of the site's parts", async () => {
    await write(`${front}::: new: lamp posts\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    await ws.keep(page(), 4, false);
    await write(`${front}::: lamp-posts\n:::\n`);
    const version = ws.site.catalog.version;
    const done = await ws.keep(page(), 4, true);
    expect(done).toMatchObject({ version: version + 1, part: { name: "lamp-posts" } });
    expect(ws.site.catalog.parts["lamp-posts"]?.origin).toBeUndefined();
    expect(existsSync(join(dir, "parts/lamp-posts"))).toBe(false);
    expect(existsSync(join(catalogDir, "layouts/_partials/parts/lamp-posts.html"))).toBe(true);
    expect(ws.site.ownProblems).toEqual([]);
  });
});

describe("a take", () => {
  test("is briefed with the take before it, its files already in the folder, and none of what a first draft needs", async () => {
    const { brief, runDraft } = await import("../src/server/draft.ts");
    const prev = join(tmp, "prev-take");
    mkdirSync(prev, { recursive: true });
    writeFileSync(join(prev, "part.yaml"), "name: kite-tails\ndescription: Kite tails.\nchildren: true\n");
    writeFileSync(join(prev, "part.html"), `<div class="part part-kite-tails">{{ .inner }}</div>\n`);
    writeFileSync(join(prev, "part.css"), ".part-kite-tails { color: var(--ink); }\n");
    const first = brief(ws.site, { words: "kite tails", inside: "" });
    const take = brief(ws.site, { words: "kite tails", inside: "", previous: { dir: prev, change: "longer tails" } });
    // A first draft is asked whether the catalog has it, with examples; a take is not.
    expect(first).toContain("exists.txt");
    expect(take).not.toContain("exists.txt");
    for (const [name] of (await import("../src/server/draft.ts")).EXAMPLES) {
      expect(first).toContain(`### ${name}`);
      expect(take).not.toContain(`### ${name}`);
    }
    expect(take).toContain("longer tails");
    expect(take).toContain(".part-kite-tails { color: var(--ink); }");
    expect(take.length).toBeLessThan(first.length);

    // The files are there to edit; a tool that leaves them as they were made nothing.
    const out = join(tmp, "take-out");
    mkdirSync(out, { recursive: true });
    const state = { id: "take-out", words: "kite tails", status: "drafting" as const, started: Date.now() };
    const idle = async () => ({});
    const end = await runDraft(ws.site, out, state, { words: "kite tails", inside: "", previous: { dir: prev, change: "longer tails" } }, idle, new AbortController().signal, async () => {});
    expect(readFileSync(join(out, "part.css"), "utf8")).toBe(readFileSync(join(prev, "part.css"), "utf8"));
    expect(end.status).toBe("failed");
    expect(end.message).toContain("changed nothing");
  });

  test("a take's prompt names the change; a resumed run that changed nothing tries once more, fresh", async () => {
    const { runDraft, takePrompt } = await import("../src/server/draft.ts");
    expect(takePrompt("rounder corners")).toContain("rounder corners");
    expect(takePrompt("rounder corners")).toContain("brief.md");
    const prev = join(tmp, "prev-take");
    const out = join(tmp, "take-resumed");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const calls: { prompt: string; resume?: string }[] = [];
    // Resumed, it thinks the work is done and writes nothing; fresh, it edits.
    const harness = async (d: string, prompt: string, _s: AbortSignal, _l?: (l: string) => void, _u?: unknown, resume?: { id: string }) => {
      calls.push({ prompt, ...(resume ? { resume: resume.id } : {}) });
      if (resume) return { resumed: true, stats: { turns: 1 } };
      writeFileSync(join(d, "part.css"), ".part-kite-tails { color: var(--accent); }\n");
      return { resumed: false, stats: { turns: 3 } };
    };
    const state = { id: "take-resumed", words: "kite tails", status: "drafting" as const, started: Date.now() };
    const end = await runDraft(ws.site, out, state, { words: "kite tails", inside: "", previous: { dir: prev, change: "rounder corners" }, resume: { id: "s-old", harness: "claude", cwd: "/x" } }, harness as never, new AbortController().signal, async () => {});
    expect(calls.map((c) => c.resume)).toEqual(["s-old", undefined]);
    expect(calls[0]!.prompt).toContain("rounder corners");
    expect(end).toMatchObject({ status: "ready", runs: 2, resumed: true, stats: { turns: 4 } });
  });

  test("a drafter chosen for one draft drafts that one alone; the next is the default's", async () => {
    await write(`${front}::: new: river stones\n:::\n`);
    uses = [];
    await ws.build(page(), 4, { drafter: { harness: "claude", model: "opus", effort: "medium" } });
    await ws.drafted();
    await ws.build(page(), 4, { change: "", drafter: { harness: "claude", model: "haiku" } });
    await ws.drafted();
    await ws.build(page(), 4, { change: "" });
    await ws.drafted();
    expect(uses).toEqual(["opus", "haiku", "default"]);
    expect(ws.draft(page(), 4)).toMatchObject({ status: "ready", takes: 3 });
    await ws.cancel(page(), 4);
  });
});

describe("the record, to study the tools by", () => {
  test("a take goes on with the take on screen's conversation, and each draft's line says what it took", async () => {
    await write(`${front}::: new: wind chimes\n:::\n`);
    await ws.build(page(), 4);
    await ws.drafted();
    const first = readDrafts(dir).find((d) => d.words === "wind chimes")!;
    expect(first).toMatchObject({ kind: "first", runs: 1, drafter: { model: "sonnet", effort: "low" }, stats: { cost: 0.1 } });
    expect(first.brief).toMatch(/^[0-9a-f]{8}$/);
    resumes = [];
    await ws.build(page(), 4, { change: "brass ones" });
    await ws.drafted();
    expect(resumes).toEqual([first.session!.id]);
    // Back to the first take: the next one goes on with its conversation.
    const second = readDrafts(dir).find((d) => d.words === "wind chimes" && d.id !== first.id)!;
    await ws.take(page(), 4, -1);
    resumes = [];
    await ws.build(page(), 4, { change: "" });
    await ws.drafted();
    expect(resumes).toEqual([first.session!.id]);
    expect(resumes).not.toContain(second.session!.id);
    await ws.keep(page(), 4, false);
    const lines = readFileSync(join(dir, DRAFT_INDEX), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.words === "wind chimes");
    expect(lines.map((l) => l.kind).sort()).toEqual(["another", "change", "first"]);
    expect(lines.map((l) => `${l.kind} ${l.resumed}`).sort()).toEqual(["another true", "change true", "first false"]);
    for (const l of lines) {
      expect(l).toMatchObject({ runs: 1, firstTry: true, cost: 0.1, thinking: 50, drafter: { model: "sonnet" } });
      expect(l.brief).toBe(first.brief);
    }
  });

  test("a second try, after the checks refused the first, goes on with the first try's conversation, and counts", async () => {
    await write(`${front}::: new: broken bells\n:::\n`);
    resumes = [];
    await ws.build(page(), 4);
    await ws.drafted();
    expect(resumes).toHaveLength(2);
    expect(resumes[0]).toBeUndefined();
    expect(resumes[1]).toMatch(/^s-/);
    const d = readDrafts(dir).find((x) => x.words === "broken bells")!;
    expect(d).toMatchObject({ status: "ready", runs: 2, refused: 1, stats: { cost: 0.2, turns: 4 } });
    await ws.cancel(page(), 4);
  });
});
