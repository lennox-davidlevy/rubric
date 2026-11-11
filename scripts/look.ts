// Draws each theme's catalog page and stress page in a real browser, at a
// phone, a tablet and a laptop width, and checks what is drawn rather than
// what the CSS says: nothing scrolls sideways, every piece of writing can be
// read against what is really behind it (after color-mix, transparency and
// nesting), no file is missing, no script fails. Saves a picture of each to
// catalogs/<catalog>/shots/<theme>/ with an index.html to look at them side
// by side.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { Problem } from "../src/theme.ts";

export const WIDTHS = [360, 768, 1280];

type Found = { kind: "contrast" | "overflow" | "spill"; what: string; detail: string };

// Runs in the page. Kept free of outside names, since it is sent as source.
function inspect(): Found[] {
  const found: Found[] = [];
  type C = [number, number, number, number];
  const parse = (s: string): C | null => {
    let m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s);
    if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]];
    m = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/.exec(s);
    if (m) return [+m[1]! * 255, +m[2]! * 255, +m[3]! * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const over = (top: C, under: C): C => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (!a) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i]! * top[3] + under[i]! * under[3] * (1 - top[3])) / a).concat(a) as C;
  };
  const lum = (c: C) => {
    const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: C, b: C) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
  const name = (e: Element) => {
    const cls = [...e.classList].filter((c) => !c.startsWith("chroma")).slice(0, 3).join(".");
    const text = (e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${e.tagName.toLowerCase()}${cls ? "." + cls : ""} "${text}"`;
  };
  // The ground behind an element: its own background and its ancestors',
  // laid over each other until one is solid. null when a picture or a
  // gradient is behind it, which cannot be measured this way.
  const ground = (e: Element): C | null => {
    const layers: C[] = [];
    for (let n: Element | null = e; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none") return null;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let g: C = [255, 255, 255, 1];
    for (const l of layers.reverse()) g = over(l, g);
    return g;
  };
  const opacity = (e: Element) => { let o = 1; for (let n: Element | null = e; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const visible = (e: Element) => {
    if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom + scrollY > 0;
  };
  const large = (cs: CSSStyleDeclaration) => parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
  const checkText = (e: Element, cs: CSSStyleDeclaration, label: string) => {
    const fg = parse(cs.color), bg = ground(e);
    if (!fg || !bg) return;
    const shown: C = [fg[0], fg[1], fg[2], fg[3] * opacity(e)];
    const r = ratio(over(shown, bg), bg), need = large(cs) ? 3 : 4.5;
    if (r < need) found.push({ kind: "contrast", what: label, detail: `contrast ${r.toFixed(2)}, needs ${need}` });
  };

  for (const e of document.querySelectorAll("body *")) {
    if (!visible(e) || e.closest(".rubric-lightbox")) continue;
    const cs = getComputedStyle(e);
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (own) checkText(e, cs, name(e));
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(e, pseudo);
      if (/^["']\S/.test(ps.content) && ps.display !== "none" && +ps.opacity === 1) checkText(e, ps, `${name(e)}${pseudo} ${ps.content}`);
    }
    // Writing that runs out of its own box, where nothing clips or scrolls it.
    if (own && e.scrollWidth > e.clientWidth + 1 && cs.overflowX === "visible" && cs.display !== "inline") {
      found.push({ kind: "spill", what: name(e), detail: `runs ${e.scrollWidth - e.clientWidth}px out of its box` });
    }
  }
  // The page scrolls sideways: name what reaches past the screen's edge,
  // outside anything that scrolls or clips on its own.
  const edge = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > edge + 1) {
    const clipped = (e: Element) => { for (let n = e.parentElement; n; n = n.parentElement) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(n).overflowX)) return true; } return false; };
    const wide = [...document.querySelectorAll("body *")].filter((e) => visible(e) && e.getBoundingClientRect().right > edge + 1 && !clipped(e));
    // The innermost: the thing to fix, not everything holding it.
    const outer = wide.filter((e) => !wide.some((o) => o !== e && e.contains(o)));
    for (const e of outer.slice(0, 3)) found.push({ kind: "overflow", what: name(e), detail: `reaches ${Math.round(e.getBoundingClientRect().right - edge)}px past the screen` });
    if (!outer.length) found.push({ kind: "overflow", what: "the page", detail: `is ${document.documentElement.scrollWidth - edge}px wider than the screen` });
  }
  return found;
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

// The picture of each theme in the editor's theme list: the first screen of
// its sample post at a laptop's width, made smaller. Saved to
// catalogs/<catalog>/previews/<theme>.png, which is committed, so a writer
// never needs a browser to see them.
export const PREVIEW = { width: 1280, height: 800, out: "800x500" };

export async function previews(catalog: string, themes: string[]): Promise<string[]> {
  const site = join(catalog, "page");
  const built = mkdtempSync(join(tmpdir(), "rubric-previews-"));
  const build = Bun.spawnSync(["hugo", "-s", site, "-d", built, "--quiet"], { stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) {
    rmSync(built, { recursive: true, force: true });
    throw new Error(`hugo failed: ${build.stderr.toString() || build.stdout.toString()}`);
  }
  const server = serve(built);
  const browser = await chromium.launch();
  const dir = join(catalog, "previews");
  mkdirSync(dir, { recursive: true });
  const made: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: PREVIEW.width, height: PREVIEW.height } });
    for (const theme of themes) {
      await page.goto(`http://localhost:${server.port}/sample/${theme}/`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const raw = join(built, `${theme}.png`);
      await page.screenshot({ path: raw });
      const out = join(dir, `${theme}.png`);
      // Fewer colors keep each picture small enough to commit 71 of them.
      const shrink = Bun.spawnSync(["magick", raw, "-resize", PREVIEW.out, "-strip", "-colors", "192", `PNG8:${out}`], { stderr: "pipe" });
      if (shrink.exitCode !== 0) throw new Error(`magick failed for ${theme}: ${shrink.stderr.toString()}`);
      made.push(out);
    }
  } finally {
    await browser.close();
    server.stop(true);
    rmSync(built, { recursive: true, force: true });
  }
  return made;
}

export async function look(catalog: string, themes: string[]): Promise<Problem[]> {
  const out: Problem[] = [];
  const site = join(catalog, "page");
  const built = mkdtempSync(join(tmpdir(), "rubric-look-"));
  const build = Bun.spawnSync(["hugo", "-s", site, "-d", built, "--quiet"], { stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) {
    rmSync(built, { recursive: true, force: true });
    return [{ where: "catalog page", level: "error", message: `hugo failed: ${(build.stderr.toString() + build.stdout.toString()).trim().split("\n").filter((l) => /ERROR/.test(l)).join("\n") || "see hugo's output"}` }];
  }
  const server = serve(built);
  const browser = await chromium.launch();
  const shots = join(catalog, "shots");
  const sheet: string[] = [];
  try {
    for (const theme of themes) {
      mkdirSync(join(shots, theme), { recursive: true });
      // The catalog and stress pages in the theme, and a post wearing the
      // site's frame; each in dark too, which a frame's theme-switch offers
      // and which the reader's system asks for.
      const pages: [string, string, boolean][] = [["catalog", `/${theme}/`, false], ["stress", `/stress/${theme}/`, false], ["stress-dark", `/stress/${theme}/`, true]];
      if (await Bun.file(join(built, "posts/second/index.html")).exists() && theme === themes[0]) pages.push(["post", "/posts/second/", false], ["post-dark", "/posts/second/", true]);
      for (const [label, path, dark] of pages) {
        sheet.push(`<h2>${theme}: ${label}</h2><div class="row">`);
        for (const width of WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: dark ? "dark" : "light" });
          const where = `${label}/${theme} at ${width}px`;
          const failed: string[] = [];
          page.on("response", (r) => { if (r.status() >= 400) failed.push(new URL(r.url()).pathname); });
          page.on("pageerror", (e) => out.push({ where, level: "error", message: `script error: ${e.message}` }));
          await page.goto(`http://localhost:${server.port}${path}`, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          // Lazy pictures load only near the screen; a full-page picture needs them all.
          await page.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = "eager"; return i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }); })));
          const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "error").map((f) => f.family));
          for (const f of fonts) out.push({ where, level: "error", message: `the font ${f} failed to load` });
          for (const f of new Set(failed)) out.push({ where, level: "error", message: `missing file ${f}` });
          // A catalog page that shows no parts is broken, however clean it looks.
          if (label === "catalog" && (await page.locator(".catalog-part").count()) === 0) {
            out.push({ where, level: "error", message: "the catalog page shows no parts" });
          }
          const seen = new Set<string>();
          for (const f of await page.evaluate(inspect)) {
            const key = `${f.kind} ${f.what}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ where, level: f.kind === "spill" ? "warning" : "error", message: `${f.what}: ${f.detail}` });
          }
          const file = `${label}-${width}.png`;
          await page.screenshot({ path: join(shots, theme, file), fullPage: true });
          sheet.push(`<figure><figcaption>${width}px</figcaption><a href="${theme}/${file}"><img src="${theme}/${file}" width="${Math.round(width / 2)}"></a></figure>`);
          await page.close();
        }
        sheet.push(`</div>`);
      }
    }
  } finally {
    await browser.close();
    server.stop(true);
    rmSync(built, { recursive: true, force: true });
  }
  writeFileSync(join(shots, "index.html"), `<!doctype html><meta charset="utf-8"><title>Theme shots</title>
<style>body{font:14px system-ui;margin:24px;background:#eee}.row{display:flex;gap:16px;align-items:flex-start}figure{margin:0}img{display:block;border:1px solid #ccc;background:#fff}</style>
<h1>Theme shots</h1>${sheet.join("\n")}`);
  console.log(`pictures in ${join(shots, "index.html")}`);
  return out;
}
