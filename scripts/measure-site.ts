// The free first step of a theme from a site (docs/plan.md, "Before the
// app", 5): read a page of a site in a headless browser, at a desktop and a
// phone width, and turn what is drawn (computed colors, faces, sizes,
// spacing, corners) into a palette, a pairing and a scale in the pipeline's
// own form. Nothing of the site's code, pictures or fonts is kept; only
// numbers and names. A trial: nothing in Rubric calls it yet.
//
//   bun scripts/measure-site.ts <post url> [name]
//
// Writes measure/<name>/ (ignored): measured.json with everything read, and
// palette.yaml, pairing.yaml and scale.yaml, drafts to compare with a theme
// made by hand, with a desktop and a phone picture of the page for the eye.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { parse, stringify } from "yaml";
import { checkPalette, contrast, hex, mix, parsePalette, toHex, type RGB } from "../src/theme.ts";

const root = join(import.meta.dir, "..");
const [url, nameArg] = process.argv.slice(2);
if (!url) throw new Error("usage: bun scripts/measure-site.ts <post url> [name]");
const name = nameArg ?? new URL(url).hostname.replace(/^www\./, "").split(".")[0]!;
const out = join(root, "measure", name);
mkdirSync(out, { recursive: true });

// Runs in the page; kept free of outside names, since it is sent as source.
function read() {
  const parse = (s: string): [number, number, number, number] | null => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s);
    if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]];
    const c = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/.exec(s);
    if (c) return [+c[1]! * 255, +c[2]! * 255, +c[3]! * 255, c[4] === undefined ? 1 : +c[4]];
    // oklch, lab and the rest: let the browser turn it into rgb.
    const probe = document.createElement("i");
    probe.style.color = s;
    document.body.append(probe);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    probe.remove();
    return d[3] ? [d[0]!, d[1]!, d[2]!, d[3]! / 255] : null;
  };
  const hexOf = (c: [number, number, number, number] | null) =>
    c && c[3] > 0.5 ? "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : null;
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && e.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  };
  // The ground behind an element: the first ancestor with a solid background.
  const ground = (e: Element | null) => {
    for (let n = e; n; n = n.parentElement) {
      const c = hexOf(parse(getComputedStyle(n).backgroundColor));
      if (c) return { color: c, el: n };
    }
    return { color: "#ffffff", el: document.documentElement };
  };
  const mode = <T,>(xs: T[]) => {
    const m = new Map<string, { v: T; n: number }>();
    for (const x of xs) { const k = JSON.stringify(x); m.set(k, { v: x, n: (m.get(k)?.n ?? 0) + 1 }); }
    return [...m.values()].sort((a, b) => b.n - a.n).map((e) => ({ value: e.v, count: e.n }));
  };
  const style = (e: Element) => {
    const cs = getComputedStyle(e);
    return { family: cs.fontFamily, size: parseFloat(cs.fontSize), weight: +cs.fontWeight, leading: cs.lineHeight === "normal" ? null : parseFloat(cs.lineHeight), color: hexOf(parse(cs.color)), tracking: cs.letterSpacing, transform: cs.textTransform, style: cs.fontStyle };
  };

  // The writing: paragraphs long enough to be prose, by their most common look.
  const paras = [...document.querySelectorAll("p")].filter((p) => visible(p) && (p.textContent ?? "").trim().length > 80 && !p.closest("nav, header, footer, aside"));
  const looks = mode(paras.map((p) => { const s = style(p); return { family: s.family, size: s.size, color: s.color }; }));
  const writingLook = looks[0]?.value;
  const writing = paras.filter((p) => { const s = style(p); return writingLook && s.family === writingLook.family && s.size === writingLook.size; });
  const first = writing[0];
  if (!first) return { error: "no paragraphs of writing found" };
  const w = style(first);
  const widths = writing.map((p) => p.getBoundingClientRect().width);
  const left = Math.min(...writing.map((p) => p.getBoundingClientRect().left));
  const gaps = writing.slice(1).map((p, i) => Math.round(p.getBoundingClientRect().top - writing[i]!.getBoundingClientRect().bottom)).filter((g) => g > 0 && g < 100);
  // The page is what is beside the writing, at its height, near the edge:
  // the body's own color may be a band at the top.
  const sheet = ground(first);
  const top = first.getBoundingClientRect().top + 4;
  const page = ground(document.elementFromPoint(4, Math.min(Math.max(top, 0), innerHeight - 1)) ?? document.body);
  // The title: the largest heading on the writing's own ground, so a site's
  // name in a band of its own color is not taken for it.
  const titleEl = [...document.querySelectorAll("h1, h2")].filter((e) => visible(e) && ground(e).color === sheet.color).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
  const titleOnWriting = !!titleEl;

  // Headings: the title is the largest h1 on the page.
  const h = (sel: string) => {
    const e = [...document.querySelectorAll(sel)].filter(visible).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
    return e ? style(e) : null;
  };

  // Links in the writing.
  const a = writing.flatMap((p) => [...p.querySelectorAll("a")]).find(visible);
  const link = a ? { ...style(a), line: getComputedStyle(a).textDecorationLine, lineStyle: getComputedStyle(a).textDecorationStyle, lineColor: hexOf(parse(getComputedStyle(a).textDecorationColor)), border: getComputedStyle(a).borderBottomStyle } : null;

  // Every visible element's colors, counted by area, to find the accent:
  // the most used color with real chroma.
  const used: { color: string; area: number; what: string }[] = [];
  const els = [...document.querySelectorAll("body *")].filter(visible).slice(0, 4000);
  for (const e of els) {
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    const fg = hexOf(parse(cs.color));
    if (fg && text) used.push({ color: fg, area: (e.textContent ?? "").trim().length * parseFloat(cs.fontSize) ** 2, what: "text" });
    const bg = hexOf(parse(cs.backgroundColor));
    if (bg) used.push({ color: bg, area: Math.min(r.width * r.height, 20000), what: "fill" });
    for (const side of ["Top", "Bottom", "Left", "Right"] as const) {
      if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none") {
        const b = hexOf(parse(cs[`border${side}Color`]));
        if (b) used.push({ color: b, area: side === "Top" || side === "Bottom" ? r.width : r.height, what: "border" });
      }
    }
  }
  // Smaller text than the writing: captions, dates, the trail.
  const small = els.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && parseFloat(getComputedStyle(e).fontSize) < w.size - 0.5).map((e) => style(e));
  const lines = [...document.querySelectorAll("hr")].filter(visible).map((e) => hexOf(parse(getComputedStyle(e).borderTopColor)) ?? hexOf(parse(getComputedStyle(e).backgroundColor)));
  const codeEl = [...document.querySelectorAll("pre, :not(pre) > code")].filter(visible);
  const code = codeEl.map((e) => ({ block: e.tagName === "PRE", ...style(e), ground: hexOf(parse(getComputedStyle(e).backgroundColor)) }));
  const radii = [...document.querySelectorAll("pre, img, figure, button, input, blockquote, [class*=card], [class*=callout], [class*=note]")].filter(visible).map((e) => getComputedStyle(e).borderTopLeftRadius).filter((r) => r !== "0px");
  const controls = [...document.querySelectorAll("button, input, select, a[class*=button], a[class*=btn]")].filter(visible).map((e) => getComputedStyle(e).borderTopLeftRadius);
  const borders = [...document.querySelectorAll("hr, pre, blockquote, table, td, input")].filter(visible).map((e) => getComputedStyle(e).borderTopWidth).filter((b) => b !== "0px");
  const quote = [...document.querySelectorAll("blockquote")].filter(visible).map((e) => style(e));
  const nav = [...document.querySelectorAll("nav a, header a")].filter(visible).map((e) => style(e));
  const figures = [...document.querySelectorAll("figure, img, pre")].filter(visible).map((e) => Math.round(e.getBoundingClientRect().width));
  const faces = [...document.fonts].filter((f) => f.status === "loaded").map((f) => ({ family: f.family.replace(/^["']|["']$/g, ""), style: f.style, weight: f.weight }));
  // Where each family is really used: by how many pieces of text, at what
  // size, in capitals or not. A face only for labels is the pairing's ui.
  const firstFamily = (e: Element) => getComputedStyle(e).fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
  const texts = els.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
  const families = mode(texts.map(firstFamily)).map(({ value, count }) => {
    const of = texts.filter((e) => firstFamily(e) === value);
    return { family: value, count, sizes: mode(of.map((e) => parseFloat(getComputedStyle(e).fontSize))).slice(0, 3).map((m) => m.value), uppercase: of.filter((e) => getComputedStyle(e).textTransform === "uppercase").length, chars: of.reduce((t, e) => t + (e.textContent ?? "").trim().length, 0) };
  });
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;

  return {
    viewport: innerWidth, dark, page: page.color, sheet: sheet.color, sheetIsPage: sheet.el === page.el || sheet.color === page.color, titleOnWriting,
    writing: { ...w, measure: Math.round(Math.max(...widths)), left: Math.round(left), gap: mode(gaps)[0]?.value ?? null, count: writing.length },
    title: titleEl ? style(titleEl) : h("h1"), h2: h("h2"), h3: h("h3"), link, quote: mode(quote)[0]?.value ?? null, nav: mode(nav)[0]?.value ?? null,
    small: mode(small.map((s) => ({ color: s.color, size: s.size, family: s.family, transform: s.transform }))).slice(0, 5),
    used: mode(used.map((u) => u.color)).map((m) => ({ color: m.value, area: used.filter((u) => u.color === m.value).reduce((t, u) => t + u.area, 0), as: [...new Set(used.filter((u) => u.color === m.value).map((u) => u.what))] })).sort((x, y) => y.area - x.area).slice(0, 25),
    lines: mode(lines).slice(0, 3), code: mode(code).slice(0, 3), radii: mode(radii).slice(0, 4), controls: mode(controls).slice(0, 3), borders: mode(borders).slice(0, 3),
    figures: mode(figures).slice(0, 4), faces, families,
  };
}

type Read = Exclude<ReturnType<typeof read>, { error: string }>;

async function measure(page: Page, width: number, dark: boolean): Promise<Read> {
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url!, { waitUntil: "networkidle", timeout: 45_000 });
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(read);
  if ("error" in r) throw new Error(`${url} at ${width}px: ${r.error}`);
  return r as Read;
}

// Color work, done here rather than in the page.
const rgb = (s: string): RGB => hex(s);
const chroma = (c: RGB) => Math.max(...c) - Math.min(...c);
const lum = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

function palette(r: Read, dark: Read | undefined) {
  const paper = r.page;
  const raised = r.sheetIsPage ? undefined : r.sheet;
  const ground = raised ?? paper;
  const ink = r.writing.color!;
  // The accent: the links' color when they have one, else the most used
  // color with real chroma that reads on the ground.
  const linkColored = r.link?.color && chroma(rgb(r.link.color)) > 60 ? r.link.color : undefined;
  const accent = linkColored ?? r.used.find((u) => chroma(rgb(u.color)) > 60 && contrast(rgb(u.color), rgb(ground)) > 2)?.color ?? ink;
  const muted = r.small.map((s) => s.color!).find((c) => c && c !== ink && contrast(rgb(c), rgb(ground)) >= 3 && chroma(rgb(c)) < 60) ?? null;
  // A rule is a faint line that still shows on the ground it is drawn on.
  const faint = (c: string | null | undefined) => !!c && contrast(rgb(c), rgb(ground)) > 1.05 && contrast(rgb(c), rgb(ground)) < 2;
  const rule = [r.lines[0]?.value, ...r.used.filter((u) => u.as.includes("border")).map((u) => u.color)].find(faint) ?? null;
  // Text colors that don't read on the writing's ground came from a band.
  const reads = (c: string | null | undefined) => (c && contrast(rgb(c), rgb(ground)) >= 3 ? c : undefined);
  const codeBlock = r.code.find((c) => c.value.block)?.value;
  const tint = r.used.find((u) => u.as.includes("fill") && u.color !== paper && u.color !== raised && contrast(rgb(u.color), rgb(ground)) < 1.3)?.color ?? null;
  const p: Record<string, unknown> = {
    description: `measured from ${new URL(url!).hostname}`,
    scheme: lum(rgb(paper)) > 0.5 ? "light" : "dark",
    paper, ...(raised ? { raised } : {}), ink,
    // A title on a band of its own color says nothing of the headings.
    heading: reads(r.titleOnWriting ? r.title?.color : r.h2?.color) ?? ink,
    link: reads(r.link?.color) ?? ink,
    accent, muted, rule, tint,
    ...(codeBlock?.ground ? { "code-paper": codeBlock.ground, "code-ink": codeBlock.color } : {}),
  };
  if (dark && dark.page !== r.page) {
    p.dark = { paper: dark.page, ink: dark.writing.color, accent: dark.used.find((u) => chroma(rgb(u.color)) > 60 && contrast(rgb(u.color), rgb(dark.sheetIsPage ? dark.page : dark.sheet)) > 2)?.color ?? dark.link?.color, ...(dark.sheetIsPage ? {} : { raised: dark.sheet }) };
  }
  return p;
}

// The families as the page names them, first one first. Free faces are
// Fontsource's open-licensed list (Google's and others); names compare
// without spaces or case, since pages write "departureMono".
const familyList = (s: string | undefined) => (s ?? "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
const key = (f: string) => f.toLowerCase().replace(/[\s_-]+/g, "");
const GENERIC = /^(serif|sans-serif|monospace|system-ui|ui-[a-z-]+|-apple-system|BlinkMacSystemFont|Segoe UI|Helvetica( Neue)?|Arial|Georgia|Times( New Roman)?|Menlo|Monaco|Consolas|Courier( New)?|SFMono-Regular|SF Mono)$/i;
async function freeFamilies(): Promise<Map<string, { family: string; license: string; category: string }>> {
  const cache = join(root, "measure", ".fontsource.json");
  let text: string;
  try { text = readFileSync(cache, "utf8"); } catch {
    text = await (await fetch("https://api.fontsource.org/v1/fonts")).text();
    writeFileSync(cache, text);
  }
  const list = JSON.parse(text) as { family: string; license: string; category: string }[];
  return new Map(list.filter((f) => /OFL|Apache|MIT|UFL|CC0/i.test(f.license)).map((f) => [key(f.family), f]));
}
function shipped(): Set<string> {
  const dir = join(root, "catalogs/universal/themes/pairings");
  const s = new Set<string>();
  for (const f of readdirSync(dir)) for (const face of (parse(readFileSync(join(dir, f), "utf8")).faces ?? []) as { family: string }[]) s.add(key(face.family));
  return s;
}
// What to do with a stack: its first face if it can be had, else the first
// free face the site names after it (its own stand-in), else the reader's.
function verdict(stack: string[], free: Map<string, { family: string }>, ours: Set<string>, all: string[][] = []): string {
  const [first] = stack;
  // Every stack on the page that starts with the same face may name its stand-in.
  const rest = [...stack.slice(1), ...all.filter((s) => s[0] === first).flatMap((s) => s.slice(1))];
  if (!first) return "none";
  const can = (f: string) => ours.has(key(f)) ? "shipped" : free.has(key(f)) ? "free, to vendor" : GENERIC.test(f) ? "the reader's own" : undefined;
  const own = can(first);
  if (own) return `${first} (${own})`;
  const standIn = rest.find((f) => !/fallback/i.test(f) && can(f) && !GENERIC.test(f));
  const generic = rest.find((f) => GENERIC.test(f));
  return `${first} (not free) -> ${standIn ? `${standIn} (${can(standIn)}, the site's own fallback)` : `the nearest shipped ${generic ?? "face"}`}`;
}

function pairing(r: Read, free: Map<string, { family: string }>, ours: Set<string>) {
  const body = familyList(r.writing.family);
  const display = familyList(r.title?.family);
  const mono = familyList(r.code[0]?.value.family);
  // The ui face: a family other than the writing's, used on many short or
  // capitalized pieces of text (labels, the trail, captions), else the
  // navigation's.
  const label = r.families.find((f) => f.family !== body[0] && f.family !== mono[0] && f.count >= 5 && (f.uppercase > f.count / 2 || ((f.sizes[0] ?? 99) < r.writing.size && f.chars / f.count < 60)));
  const ui = label ? [label.family] : familyList(r.nav?.family);
  const say = (fs: string[]) => verdict(fs, free, ours, [body, display, mono, ui]);
  return {
    description: `measured from ${new URL(url!).hostname}`,
    found: { body: say(body), display: say(display), mono: say(mono), ui: say(ui) },
    body, display: display.join() === body.join() ? "body" : display, mono, ui,
    weight: { body: r.writing.weight, strong: 700, heading: r.h2?.weight ?? r.title?.weight, display: r.title?.weight },
    leading: { body: round(r.writing.leading! / r.writing.size), heading: r.h2?.leading ? round(r.h2.leading / r.h2.size) : null, display: r.title?.leading ? round(r.title.leading / r.title.size) : null },
    tracking: { display: em(r.title?.tracking, r.title?.size), label: "0em" },
    labels: r.small.some((s) => s.value.transform === "uppercase") || r.nav?.transform === "uppercase" || (label !== undefined && label.uppercase > label.count / 2) ? "uppercase" : "none",
    quote: r.quote?.style === "italic" ? "italic" : "normal",
    links: !r.link || r.link.line.includes("underline") || r.link.border !== "none" ? "always" : "hover",
    code: ((c) => (c ? `${round(c.value.size / r.writing.size)}em` : null))(r.code.find((c) => c.value.size >= r.writing.size * 0.6)),
  };
}
const round = (n: number) => Math.round(n * 100) / 100;
const em = (px: string | undefined, size: number | undefined) => (!px || px === "normal" || !size ? "0em" : `${round(parseFloat(px) / size)}em`);

function scale(desk: Read, phone: Read) {
  const rem = 16;
  // The title sits on the top step, four above the writing.
  const ratio = (r: Read) => Math.max(1.05, r.title && r.title.size > r.writing.size ? round((r.title.size / r.writing.size) ** (1 / 4)) : 1.2);
  return {
    description: `measured from ${new URL(url!).hostname}`,
    screen: [phone.viewport, desk.viewport],
    body: [phone.writing.size, desk.writing.size],
    ratio: [ratio(phone), ratio(desk)],
    title: { phone: phone.title?.size ?? null, desktop: desk.title?.size ?? null },
    headings: { h2: desk.h2?.size ?? null, h3: desk.h3?.size ?? null },
    paragraphGap: desk.writing.gap,
    measure: `${round(desk.writing.measure / rem)}rem`,
    wide: desk.figures.map((f) => f.value).filter((w) => w > desk.writing.measure + 8 && w < desk.viewport - 40)[0] ? `${round(desk.figures.map((f) => f.value).filter((w) => w > desk.writing.measure + 8 && w < desk.viewport - 40)[0]! / rem)}rem` : null,
    // Pills are a button's shape, not the theme's corners.
    radius: desk.radii.find((r) => parseFloat(r.value) < 100)?.value ?? "0px",
    border: desk.borders[0]?.value ?? "1px",
    controls: desk.controls[0]?.value ?? null,
  };
}

// The pieces in the pipeline's own form, for `theme.ts check` and `look` in
// a copy of the catalog: what the page didn't show is filled the way the
// pipeline would derive it, and every fill is said in a comment.
type Pal = ReturnType<typeof palette>;
const nearInk = (ink: string, ground: string, p: number) => toHex(mix(hex(ink), hex(ground), p));
function paletteYaml(p: Pal): { text: string; filled: string[] } {
  const filled: string[] = [];
  const ground = (p.raised ?? p.paper) as string;
  const ink = p.ink as string;
  const v = { ...p } as Record<string, unknown>;
  const fill = (k: string, value: string) => { if (!v[k]) { v[k] = value; filled.push(k); } };
  // mix(a, b, p) is p of a: muted is most of the ink, a rule and a tint little.
  fill("muted", nearInk(ink, ground, 0.62));
  fill("rule", nearInk(ink, ground, 0.12));
  fill("tint", nearInk(ink, ground, 0.04));
  if (!v.dark) {
    filled.push("dark");
    v.dark = v.scheme === "dark" ? { paper: v.paper, ink: v.ink, accent: v.accent } : { paper: "#121212", ink: "#e8e8e8", accent: toHex(mix(hex(v.accent as string), [255, 255, 255], 0.45)) };
  }
  for (const k of Object.keys(v)) if (v[k] === null) delete v[k];
  // What check refuses for contrast, deepened toward the ink a step at a
  // time, its hue kept, as a person would: the site's own color may not
  // read as text on its own ground.
  const deepened: string[] = [];
  for (let round = 0; round < 30; round++) {
    const problems = checkPalette(parsePalette("measured", v as never)).filter((x) => x.level === "error");
    if (!problems.length) break;
    // The color being read is the one before " on ", but for a filled
    // button ("paper on accent"), where it is the accent's ground. A dark
    // one moves toward the dark ink, in the dark section.
    const named = new Set<string>();
    for (const x of problems) {
      const m = /^([a-z-]+) on ([a-z-]+)/.exec(x.message);
      if (!m) continue;
      const fg = m[1] === "paper" && m[2] === "accent" ? "accent" : m[1] === "dark-paper" && m[2] === "dark-accent" ? "dark-accent" : m[1]!;
      if (["accent", "muted", "link", "dark-accent", "dark-muted", "dark-link"].includes(fg)) named.add(fg);
    }
    if (!named.size) break;
    const dark = v.dark as Record<string, string>;
    for (const k of named) {
      const isDark = k.startsWith("dark-");
      const key = isDark ? k.slice(5) : k;
      const holder = (isDark ? dark : v) as Record<string, unknown>;
      const toward = isDark ? dark.ink! : ink;
      const c = (holder[key] as string | undefined) ?? (key === "link" ? toward : key === "muted" ? undefined : undefined);
      if (!c) continue;
      holder[key] = toHex(mix(hex(toward), hex(c), 0.06));
      if (!deepened.includes(k)) deepened.push(k);
    }
  }
  const said = [filled.length ? `filled in: ${filled.join(", ")}` : "nothing filled in", deepened.length ? `moved toward the ink to read as text: ${deepened.map((k) => (k.startsWith("dark-") ? k : `${k}${p[k as keyof Pal] ? ` (was ${p[k as keyof Pal]})` : ""}`)).join(", ")}` : ""].filter(Boolean).join("; ");
  return { text: `# Measured, not made: ${said}.\n${stringify(v)}`, filled };
}

// A free face from Fontsource, the weights and styles the pairing uses.
async function fetchFace(family: string, weights: number[], italic: boolean, fontsDir: string, free: Map<string, { family: string }>) {
  const id = family.toLowerCase().replace(/\s+/g, "-");
  const faces: { family: string; file: string; style: string; weight: number }[] = [];
  for (const [w, style] of [...new Set(weights)].map((w) => [w, "normal"] as const).concat(italic ? [[weights[0]!, "italic"] as const] : [])) {
    const file = `${id}-${w}-${style}.woff2`;
    const res = await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${w}-${style}.woff2`);
    if (!res.ok) continue;
    mkdirSync(fontsDir, { recursive: true });
    writeFileSync(join(fontsDir, file), new Uint8Array(await res.arrayBuffer()));
    faces.push({ family: free.get(key(family))?.family ?? family, file, style, weight: w });
  }
  return faces;
}

// The face a stack is drawn in: its first if shipped or free, else the
// site's own free stand-in, else the reader's own.
function usable(stacks: string[][], stack: string[], free: Map<string, { family: string }>, ours: Set<string>): { family: string; how: "shipped" | "free" } | undefined {
  const all = [...stack, ...stacks.filter((s) => s[0] === stack[0]).flatMap((s) => s.slice(1))];
  for (const f of all) {
    if (/fallback/i.test(f) || GENERIC.test(f)) continue;
    if (ours.has(key(f))) return { family: f, how: "shipped" };
    if (free.has(key(f))) return { family: free.get(key(f))!.family, how: "free" };
  }
  return undefined;
}

async function pairingYaml(pr: ReturnType<typeof pairing>, desk: Read, fontsDir: string, free: Map<string, { family: string }>, ours: Set<string>) {
  const stacks = [pr.body, Array.isArray(pr.display) ? pr.display : pr.body, pr.mono, pr.ui];
  const shippedFaces = (fam: string) => {
    const dir = join(root, "catalogs/universal/themes/pairings");
    for (const f of readdirSync(dir)) {
      const faces = ((parse(readFileSync(join(dir, f), "utf8")).faces ?? []) as { family: string }[]).filter((x) => key(x.family) === key(fam));
      if (faces.length) return faces;
    }
    return [];
  };
  const faces: unknown[] = [];
  const named: string[] = [];
  const generic = (stack: string[], fallback: string) => [...new Set(stack.filter((f) => GENERIC.test(f)).concat(fallback))];
  // A face that is neither free nor shipped, with no free stand-in named by
  // the site: the shipped face of its kind, by the generic family the site
  // falls back to.
  const KIND: Record<string, string> = { serif: "Source Serif 4", "sans-serif": "Inter", monospace: "JetBrains Mono" };
  const pick = async (stack: string[], weights: number[], italic: boolean, fallback: string) => {
    let u = usable(stacks, stack, free, ours);
    if (!u && !GENERIC.test(stack[0] ?? "")) {
      const kind = stack.find((f) => KIND[f.toLowerCase()]) ?? fallback;
      u = { family: KIND[kind.toLowerCase()] ?? KIND[fallback]!, how: "shipped" };
    }
    if (!u) return generic(stack, fallback);
    if (!named.includes(u.family)) {
      named.push(u.family);
      faces.push(...(u.how === "shipped" ? shippedFaces(u.family) : await fetchFace(u.family, weights, italic, fontsDir, free)));
    }
    return [u.family, ...generic(stack, fallback)];
  };
  const w = pr.weight;
  // Every weight the writing and the titles are drawn at, in whichever face.
  const text = [w.body, 700, w.heading ?? 700, w.display ?? 700];
  const body = await pick(pr.body, text, true, "serif");
  const display = Array.isArray(pr.display) ? await pick(pr.display, text, false, "serif") : "body";
  const mono = await pick(pr.mono, [400], false, "monospace");
  const ui = await pick(pr.ui, [400], false, "sans-serif");
  const out = {
    description: pr.description, faces: faces.map((f) => ({ ...(f as object) })), preload: [],
    body, display, mono, ui,
    weight: { body: w.body, strong: 700, heading: w.heading ?? 700, display: w.display ?? 700 },
    leading: { body: pr.leading.body, heading: pr.leading.heading ?? 1.3, display: pr.leading.display ?? 1.15 },
    tracking: pr.tracking, labels: pr.labels, numerals: "lining", quote: pr.quote, ornament: "* * *",
    code: pr.code ?? "0.875em", links: pr.links,
  };
  return `# Measured, not made. Found: ${JSON.stringify(pr.found)}\n${stringify(out)}`;
}

function scaleYaml(sc: ReturnType<typeof scale>) {
  const g = (sc.paragraphGap ?? 24) / 16;
  const q = (n: number) => Math.round(n * 4) / 4;
  const ratio = sc.ratio[1]!;
  // The parts use steps -1 to 4 whatever the site's title is.
  const steps = sc.title.desktop ? Math.max(4, Math.round(Math.log(sc.title.desktop / sc.body[1]!) / Math.log(ratio))) : 4;
  const out = {
    description: sc.description, screen: sc.screen, body: sc.body, ratio: sc.ratio, steps: [-1, steps],
    space: [q(g / 3), q((2 * g) / 3), q(g), [q((4 * g) / 3), q(2 * g)], [q(2 * g), q((10 * g) / 3)]],
    measure: sc.measure, wide: sc.wide ?? sc.measure, radius: sc.radius, border: sc.border, controls: sc.controls ?? sc.radius,
  };
  return `# Measured, not made: headings ${JSON.stringify(sc.headings)}, title ${JSON.stringify(sc.title)}.\n${stringify(out)}`;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ userAgent: undefined });
  const page = await context.newPage();
  const desk = await measure(page, 1280, false);
  await page.screenshot({ path: join(out, "desktop.png") });
  const phone = await measure(page, 390, false);
  await page.screenshot({ path: join(out, "phone.png") });
  const deskDark = await measure(page, 1280, true);
  const [free, ours] = [await freeFamilies(), shipped()];
  const result = { url, palette: palette(desk, deskDark.page !== desk.page ? deskDark : undefined), pairing: pairing(desk, free, ours), scale: scale(desk, phone) };
  writeFileSync(join(out, "measured.json"), JSON.stringify({ url, desk, phone, deskDark }, null, 1));
  for (const k of ["palette", "pairing", "scale"] as const) writeFileSync(join(out, `${k}.yaml`), stringify(result[k]));
  // The pieces, ready for a copy of the catalog (measure/catalog/).
  const themes = join(out, "themes");
  for (const k of ["palettes", "pairings", "scales"]) mkdirSync(join(themes, k), { recursive: true });
  writeFileSync(join(themes, "palettes", `${name}.yaml`), paletteYaml(result.palette).text);
  writeFileSync(join(themes, "pairings", `${name}.yaml`), await pairingYaml(result.pairing, desk, join(out, "fonts"), free, ours));
  writeFileSync(join(themes, "scales", `${name}.yaml`), scaleYaml(result.scale));
  console.log(stringify(result));
} finally {
  await browser.close();
}
