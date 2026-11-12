// Drafts the same requests with several drafters and draws them side by side,
// so a change to the brief, its examples or the default drafter is measured,
// not guessed. Each draft is a real fast draft against testing/, so a run
// costs money (about $1 for six requests on two drafters): ask before
// running it. Bun loads TYPESAFE_API_KEY from .env for Jev's look at each
// picture, which costs cents.
//
//   bun scripts/bench.ts run [--drafters opus:low,opus:medium] [--requests bench/requests.txt]
//                            [--budget 1.5] [--label words]
//   bun scripts/bench.ts draw <run> [--no-jev]   draws a run again, drafting nothing
//
// A run is a folder in bench/runs/: every draft's files and log, results.json,
// a picture of each part alone in the page, and index.html to look at them:
// the time, the cost, whether the checks passed, whether the page scrolls
// sideways on a phone, and how likely Jev finds the picture shows the thing
// (`shown` in src/core/questions.ts; a number to compare runs by, not a
// verdict; it asks about the name the drafter gave the part, which told weak
// drawings from good ones better than the whole request did). Drafting stops
// before a request once the budget is spent, so a run can pass it by one row.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { parse } from "yaml";
import { shown } from "../src/jev.ts";
import { runDraft } from "../src/server/draft.ts";
import { toolHarness } from "../src/server/harness.ts";
import { openSite } from "../src/site.ts";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] ?? fallback : fallback;
};
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

type Result = {
  request: string; drafter: string; dir: string;
  seconds?: number; cost?: number; thinking?: number; status?: string; name?: string; message?: string;
  picture?: string; overflow?: number; shown?: number; drawError?: string;
};

const drafters = option("drafters", "opus:low,opus:medium");
const requestsFile = option("requests", "bench/requests.txt");
const budget = Number(option("budget", "1.5"));
const label = option("label", "");
const noJev = flag("no-jev");
const [command, runArg] = args;

if (command === "run") {
  const requests = readFileSync(join(root, requestsFile), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const run = join(root, "bench/runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (label ? `-${label.replace(/[^a-z0-9]+/gi, "-")}` : ""));
  mkdirSync(run, { recursive: true });
  const site = await openSite(join(root, "testing"));
  const results: Result[] = [];
  let spent = 0;
  for (const [n, request] of requests.entries()) {
    if (spent >= budget) {
      console.log(`stopped before request ${n + 1} of ${requests.length}: $${spent.toFixed(2)} spent of $${budget}`);
      break;
    }
    // One request's drafters side by side; requests one after another, so the budget holds.
    const row = await Promise.all(drafters.split(",").map(async (drafter): Promise<Result> => {
      const [model, effort] = drafter.split(":");
      const rel = join(drafter.replace(":", "-"), String(n + 1));
      const dir = join(run, rel);
      mkdirSync(dir, { recursive: true });
      const started = Date.now();
      try {
        const end = await runDraft(site, dir, { id: rel.replace("/", "-"), words: request, status: "drafting", started }, { words: request, inside: "", mode: "fast" },
          toolHarness(() => ({ harness: "claude", model: model!, ...(effort ? { effort } : {}) })), new AbortController().signal, async () => {});
        return { request, drafter, dir: rel, seconds: Math.round((Date.now() - started) / 100) / 10, cost: end.stats?.cost, thinking: end.stats?.thinking, status: end.status, name: end.name, message: end.message };
      } catch (err) {
        return { request, drafter, dir: rel, seconds: Math.round((Date.now() - started) / 100) / 10, status: "failed", message: (err as Error).message };
      }
    }));
    for (const r of row) {
      spent += r.cost ?? 0;
      console.log(`${r.drafter.padEnd(14)} ${String(r.seconds).padStart(5)}s $${(r.cost ?? 0).toFixed(3)} ${r.status}${r.message ? `: ${r.message.slice(0, 80)}` : ""}  "${request.slice(0, 60)}"`);
    }
    results.push(...row);
    writeFileSync(join(run, "results.json"), JSON.stringify(results, null, 1));
  }
  console.log(`$${spent.toFixed(2)} spent on ${results.length} drafts`);
  await draw(run);
} else if (command === "draw" && runArg) {
  await draw(resolve(runArg));
} else {
  console.log(readFileSync(import.meta.path, "utf8").split("\n\n")[0]!.replace(/^\/\/ ?/gm, ""));
  process.exit(command ? 1 : 0);
}

// A site holding one drafted part, as a site's own, on a page of its own.
function siteFor(run: string, r: Result): string | undefined {
  const from = join(run, r.dir);
  if (!["part.yaml", "part.html", "part.css"].every((f) => existsSync(join(from, f)))) return undefined;
  const yaml = parse(readFileSync(join(from, "part.yaml"), "utf8")) as { name?: string; body?: string; children?: boolean };
  if (!yaml?.name) return undefined;
  r.name ??= yaml.name;
  const site = join(run, ".sites", r.dir);
  rmSync(site, { recursive: true, force: true });
  mkdirSync(join(site, "pages"), { recursive: true });
  mkdirSync(join(site, "static/images"), { recursive: true });
  cpSync(from, join(site, "parts", yaml.name), { recursive: true, filter: (src) => !/\.(log|md|json)$/.test(src) });
  cpSync(join(root, "testing/static/images/sample.jpg"), join(site, "static/images/sample.jpg"));
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(root, "testing/hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(root, "catalogs"))}`));
  writeFileSync(join(site, "rubric.md"), "::: theme gruvbox-dark\n");
  // The part with its own starter inside, as the writer first sees it; a
  // starter's pictures are names of files that don't exist.
  const body = (yaml.body ?? "").trim().replace(/\]\([^)]*\.(jpe?g|png|webp|gif)\)/g, "](/images/sample.jpg)");
  const block = yaml.children === false || !body ? `::: ${yaml.name}\n` : `::: ${yaml.name}\n${body}\n:::\n`;
  writeFileSync(join(site, "pages/_index.md"), `---\ntitle: Bench\n---\n\n${block}`);
  return site;
}

function serve(dir: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p.endsWith("/")) p += "index.html";
      const f = Bun.file(join(dir, p));
      return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
    },
  });
}

async function draw(run: string): Promise<void> {
  const results = JSON.parse(readFileSync(join(run, "results.json"), "utf8")) as Result[];
  mkdirSync(join(run, "pics"), { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const r of results) {
      delete r.drawError;
      const site = siteFor(run, r);
      if (!site) {
        r.drawError = "no files to draw";
        continue;
      }
      const wrote = Bun.spawnSync(["bun", join(root, "src/cli.ts"), "build", site], { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
      const built = Bun.spawnSync(["hugo", "-s", site, "-d", join(site, "public"), "--quiet"], { stdout: "pipe", stderr: "pipe", timeout: 60_000 });
      if (wrote.exitCode !== 0 || built.exitCode !== 0) {
        r.drawError = `could not build: ${(wrote.stderr.toString() + built.stderr.toString() + built.stdout.toString()).trim().split("\n").slice(-2).join(" ")}`;
        continue;
      }
      const server = serve(join(site, "public"));
      let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
      try {
        page = await browser.newPage();
        // The live preview's script would follow the writer's cursor elsewhere.
        await page.route(/rubric-live/, (route) => route.abort());
        await page.setViewportSize({ width: 360, height: 800 });
        await page.goto(`http://localhost:${server.port}/`);
        r.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        await page.setViewportSize({ width: 800, height: 1200 });
        await page.goto(`http://localhost:${server.port}/`);
        await page.waitForTimeout(300);
        // The part alone, its motion held partway, in a picture Jev takes
        // (at least 280 pixels a side).
        const box = await page.evaluate(() => {
          const part = document.querySelector<HTMLElement>(".intro > .part, main .part");
          if (!part) return undefined;
          for (const el of document.querySelectorAll<HTMLElement>(".intro > *, .masthead, .post-list, .site-footer")) if (el !== part) el.style.visibility = "hidden";
          for (const a of document.getAnimations()) {
            const d = a.effect?.getComputedTiming().duration;
            a.pause();
            if (typeof d === "number" && Number.isFinite(d)) a.currentTime = d * 0.6;
          }
          const b = part.getBoundingClientRect();
          return { x: b.x + scrollX, y: b.y + scrollY, w: b.width, h: b.height };
        });
        if (!box) {
          r.drawError = "the page has no part";
          continue;
        }
        const height = Math.min(1500, Math.max(300, Math.ceil(box.h) + 24));
        const picture = join("pics", `${r.dir.replace("/", "-")}.png`);
        const png = await page.screenshot({ path: join(run, picture), fullPage: true, clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - (height - box.h) / 2), width: Math.max(280, Math.min(776, box.w + 24)), height } });
        r.picture = picture;
        if (!noJev && r.name) r.shown = await shown(png, r.name.replace(/-/g, " ")).catch((err) => (console.error(`${r.dir}: ${(err as Error).message}`), undefined));
      } catch (err) {
        r.drawError = `could not draw: ${(err as Error).message.split("\n")[0]}`;
      } finally {
        await page?.close();
        server.stop(true);
      }
    }
  } finally {
    await browser.close();
    rmSync(join(run, ".sites"), { recursive: true, force: true });
  }
  writeFileSync(join(run, "results.json"), JSON.stringify(results, null, 1));
  writeFileSync(join(run, "index.html"), sheet(results));
  for (const d of [...new Set(results.map((r) => r.drafter))]) {
    const rs = results.filter((r) => r.drafter === d);
    const mean = (xs: (number | undefined)[]) => {
      const got = xs.filter((x): x is number => x !== undefined);
      return got.length ? got.reduce((a, b) => a + b, 0) / got.length : NaN;
    };
    console.log(`${d.padEnd(14)} ${rs.filter((r) => r.status === "ready").length}/${rs.length} ready, ${mean(rs.map((r) => r.seconds)).toFixed(0)}s and $${mean(rs.map((r) => r.cost)).toFixed(3)} a draft, shown ${mean(rs.map((r) => r.shown)).toFixed(2)}, ${rs.filter((r) => (r.overflow ?? 0) > 0).length} scroll sideways`);
  }
  console.log(join(run, "index.html"));
}

function sheet(results: Result[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const drafters = [...new Set(results.map((r) => r.drafter))];
  const requests = [...new Set(results.map((r) => r.request))];
  const cell = (r: Result | undefined) => !r ? "<td></td>" : `<td>
${r.picture ? `<img src="${esc(r.picture)}" alt="${esc(r.name ?? "")}">` : `<p class="bad">${esc(r.drawError ?? "not drawn")}</p>`}
<p>${[
    r.name ? `<b>${esc(r.name)}</b>` : "",
    r.seconds !== undefined ? `${r.seconds} s` : "",
    r.cost !== undefined ? `$${r.cost.toFixed(3)}` : "",
    r.status === "ready" ? "" : `<span class="bad">${esc(r.status ?? "")}${r.message ? `: ${esc(r.message)}` : ""}</span>`,
    r.shown !== undefined ? `shown ${r.shown.toFixed(2)}` : "",
    (r.overflow ?? 0) > 0 ? `<span class="bad">${r.overflow}px too wide at 360</span>` : "",
  ].filter(Boolean).join(" · ")}</p></td>`;
  return `<!doctype html>
<meta charset="utf-8">
<title>Draft bench</title>
<style>
body { background: #1d2021; color: #ebdbb2; font: 14px/1.4 system-ui, sans-serif; margin: 16px; }
table { border-collapse: collapse; }
th, td { vertical-align: top; padding: 8px; border-top: 1px solid #504945; text-align: left; }
th[scope=row] { max-width: 14em; font-weight: normal; }
img { display: block; max-width: 520px; border: 1px solid #504945; }
.bad { color: #fb4934; }
p { margin: 6px 0 0; }
</style>
<table>
<tr><th></th>${drafters.map((d) => `<th>${esc(d)}</th>`).join("")}</tr>
${requests.map((q) => `<tr><th scope="row">${esc(q)}</th>${drafters.map((d) => cell(results.find((r) => r.request === q && r.drafter === d))).join("")}</tr>`).join("\n")}
</table>
`;
}
