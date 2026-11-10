// Themes, built from three kinds of piece in a catalog's themes/ folder:
//
//   palettes/<name>.yaml  the colors
//   pairings/<name>.yaml  the fonts and how they are set
//   scales/<name>.yaml    type sizes, spacing and widths
//
// themes.yaml names the designed combinations. Each piece becomes one CSS
// file under assets/css/, which the catalog's layout loads together. The CSS
// is generated, never edited; `bun scripts/theme.ts build` writes it and
// `check` says whether a piece is fit to ship.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type Kind = "palettes" | "pairings" | "scales";
export const KINDS: Kind[] = ["palettes", "pairings", "scales"];

export class ThemeError extends Error {}

// ── colors ──────────────────────────────────────────────────────────────

export type RGB = [number, number, number];

export function hex(s: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (!m) throw new ThemeError(`${JSON.stringify(s)} is not a color like #9a3412`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as RGB;
}

export function toHex(c: RGB): string {
  return "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

// The same as CSS `color-mix(in srgb, a p%, b)`.
export function mix(a: RGB, b: RGB, p: number): RGB {
  return a.map((v, i) => v * p + b[i]! * (1 - p)) as RGB;
}

function luminance(c: RGB): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

// WCAG 2 contrast ratio, from 1 to 21.
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
}

// ── the pieces ──────────────────────────────────────────────────────────

const COLOR_KEYS = ["paper", "ink", "accent", "muted", "rule", "tint"] as const;
const DARK_KEYS = ["paper", "ink", "accent"] as const;

export type Palette = {
  name: string;
  description: string;
  scheme: "light" | "dark";
  // Every color slot, filled: the given ones and the derived ones.
  colors: Record<string, string>;
  shadow: { color: string; strength: number };
};

export type Face = { family: string; file: string; style: "normal" | "italic"; weight: [number, number] };

export type Pairing = {
  name: string;
  description: string;
  faces: Face[];
  preload: string[];
  body: string[];
  display: string[];
  mono: string[];
  weight: { body: number; strong: number; heading: number; display: number };
  leading: { body: number; heading: number; display: number };
  tracking: { body: string; display: string; label: string };
  labels: "uppercase" | "none";
  numerals: "oldstyle" | "lining";
  quote: "italic" | "normal";
  ornament: string;
  code: string;
  // Buttons, labels, navigation and forms: often a sans beside a serif.
  ui: string[];
  headingCase: "none" | "uppercase";
  // Links in the writing: always underlined, or only on hover.
  linkLine: "always" | "hover";
};

export type Scale = {
  name: string;
  description: string;
  screen: [number, number];
  body: [number, number];
  ratio: [number, number];
  steps: [number, number];
  space: (number | [number, number])[];
  measure: string;
  wide: string;
  radius: string;
  // The width of lines and borders, and the corners of buttons and inputs
  // (a pill is 999px).
  border: string;
  controlRadius: string;
  // How lines between things are drawn: some themes dash or dot them.
  rules: "solid" | "dashed" | "dotted";
};

// A skin, optionally: the theme's own small CSS layer, drawn after the parts,
// for what the slots cannot say (assets/css/skins/<skin>.css). Slots only.
export type Theme = { name: string; description: string; palette: string; pairing: string; scale: string; skin?: string };

type Raw = Record<string, unknown>;

function need(raw: Raw, key: string, where: string): unknown {
  if (raw[key] === undefined) throw new ThemeError(`${where}: missing "${key}"`);
  return raw[key];
}
const str = (raw: Raw, key: string, where: string) => {
  const v = need(raw, key, where);
  if (typeof v !== "string") throw new ThemeError(`${where}: "${key}" should be text`);
  return v;
};
const num = (raw: Raw, key: string, where: string) => {
  const v = need(raw, key, where);
  if (typeof v !== "number") throw new ThemeError(`${where}: "${key}" should be a number`);
  return v;
};
const pair = (raw: Raw, key: string, where: string): [number, number] => {
  const v = need(raw, key, where);
  if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== "number")) {
    throw new ThemeError(`${where}: "${key}" should be two numbers, smallest screen first: [18, 20]`);
  }
  return v as [number, number];
};
const list = (raw: Raw, key: string, where: string): string[] => {
  const v = need(raw, key, where);
  if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) throw new ThemeError(`${where}: "${key}" should be a list of names`);
  return v as string[];
};
const oneOf = <T extends string>(raw: Raw, key: string, where: string, allowed: readonly T[]): T => {
  const v = str(raw, key, where);
  if (!allowed.includes(v as T)) throw new ThemeError(`${where}: "${key}" should be one of ${allowed.join(", ")}`);
  return v as T;
};
const section = (raw: Raw, key: string, where: string): Raw => {
  const v = need(raw, key, where);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ThemeError(`${where}: "${key}" should be a group of settings`);
  return v as Raw;
};

const sameAs = (a: RGB, b: RGB) => a.every((v, i) => v === b[i]);

export function parsePalette(name: string, raw: Raw): Palette {
  const where = `palettes/${name}.yaml`;
  const scheme = oneOf(raw, "scheme", where, ["light", "dark"] as const);
  const c: Record<string, RGB> = {};
  for (const k of COLOR_KEYS) c[k] = hex(str(raw, k, where));
  const dark = section(raw, "dark", where);
  for (const k of DARK_KEYS) c[`dark-${k}`] = hex(str(dark, k, `${where} dark`));
  // What a palette may leave out, worked out from what it gives. Each can
  // be set by hand instead, under the same name.
  // In order: later ones may read earlier ones.
  const derived: Record<string, () => RGB> = {
    raised: () => c.paper!,
    link: () => c.ink!,
    heading: () => c.ink!,
    "code-paper": () => c.tint!,
    "code-ink": () => c.ink!,
    // Comments and keywords in code. On the tint they are the page's own
    // muted and accent; a code block of its own color (a dark block on a
    // light page) needs its own, or they vanish into it.
    "code-muted": () => sameAs(c["code-paper"]!, c.tint!) ? c.muted! : mix(c["code-ink"]!, c["code-paper"]!, 0.62),
    "code-accent": () => sameAs(c["code-paper"]!, c.tint!) ? c.accent! : c["code-ink"]!,
    // The colors of notices and marks: what went well, what to watch, what
    // could do harm. Left out, they lean on the ink and the accent.
    positive: () => c.ink!,
    warning: () => c.accent!,
    danger: () => c.accent!,
    "accent-tint": () => mix(c.accent!, c.paper!, 0.08),
    "positive-tint": () => mix(c.positive!, c.paper!, 0.08),
    "warning-tint": () => mix(c.warning!, c.paper!, 0.08),
    "danger-tint": () => mix(c.danger!, c.paper!, 0.08),
    // Links and headings in dark. Left out, they are the dark band's ink.
    "dark-link": () => c["dark-ink"]!,
    "dark-heading": () => c["dark-ink"]!,
    // A colored ground some themes give a sidebar or header, which stays in
    // dark mode. Left out, it is the dark band.
    band: () => c["dark-paper"]!,
    "band-ink": () => c["dark-ink"]!,
    "dark-muted": () => mix(c["dark-ink"]!, c["dark-paper"]!, 0.68),
    "dark-rule": () => mix(c["dark-ink"]!, c["dark-paper"]!, 0.2),
    "dark-tint": () => mix(c["dark-ink"]!, c["dark-paper"]!, 0.09),
    // A raised box in dark, which is the dark tint unless the theme has its own.
    "dark-raised": () => c["dark-tint"]!,
    "dark-accent-tint": () => mix(c["dark-accent"]!, c["dark-paper"]!, 0.12),
    // On the dark ground a notice color is lifted toward the light ink, or
    // is the dark band's accent when it was the page's accent.
    "dark-positive": () => sameAs(c.positive!, c.ink!) ? c["dark-ink"]! : mix(c.positive!, c["dark-ink"]!, 0.45),
    "dark-warning": () => sameAs(c.warning!, c.accent!) ? c["dark-accent"]! : mix(c.warning!, c["dark-ink"]!, 0.45),
    "dark-danger": () => sameAs(c.danger!, c.accent!) ? c["dark-accent"]! : mix(c.danger!, c["dark-ink"]!, 0.45),
    "dark-positive-tint": () => mix(c["dark-positive"]!, c["dark-paper"]!, 0.12),
    "dark-warning-tint": () => mix(c["dark-warning"]!, c["dark-paper"]!, 0.12),
    "dark-danger-tint": () => mix(c["dark-danger"]!, c["dark-paper"]!, 0.12),
  };
  for (const [k, make] of Object.entries(derived)) {
    const given = k.startsWith("dark-") ? dark[k.slice(5)] : raw[k];
    c[k] = given === undefined ? make() : hex(String(given));
  }
  const shadow = (raw.shadow ?? {}) as Raw;
  const colors = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, toHex(v)]));
  return {
    name,
    description: str(raw, "description", where),
    scheme,
    colors,
    shadow: {
      color: shadow.color === undefined ? (scheme === "light" ? colors.ink! : "#000000") : toHex(hex(String(shadow.color))),
      strength: shadow.strength === undefined ? 1 : num(shadow, "strength", `${where} shadow`),
    },
  };
}

export function parsePairing(name: string, raw: Raw): Pairing {
  const where = `pairings/${name}.yaml`;
  // No faces is the reader's own fonts (a system font stack): nothing to
  // fetch, so the fastest page there is.
  const facesRaw = need(raw, "faces", where);
  if (!Array.isArray(facesRaw)) throw new ThemeError(`${where}: "faces" should list the font files, or be [] for the reader's own fonts`);
  const faces = facesRaw.map((f: Raw, i) => {
    const w = `${where} faces[${i}]`;
    const weight = typeof f.weight === "number" ? [f.weight, f.weight] as [number, number] : pair(f, "weight", w);
    return { family: str(f, "family", w), file: str(f, "file", w), style: oneOf(f, "style", w, ["normal", "italic"] as const), weight };
  });
  const weight = section(raw, "weight", where), leading = section(raw, "leading", where), tracking = section(raw, "tracking", where);
  return {
    name,
    description: str(raw, "description", where),
    faces,
    preload: list(raw, "preload", where),
    body: list(raw, "body", where),
    display: raw.display === "body" ? list(raw, "body", where) : list(raw, "display", where),
    mono: list(raw, "mono", where),
    weight: {
      body: num(weight, "body", where), strong: num(weight, "strong", where),
      heading: num(weight, "heading", where), display: num(weight, "display", where),
    },
    leading: { body: num(leading, "body", where), heading: num(leading, "heading", where), display: num(leading, "display", where) },
    tracking: { body: tracking.body === undefined ? "0em" : str(tracking, "body", where), display: str(tracking, "display", where), label: str(tracking, "label", where) },
    labels: oneOf(raw, "labels", where, ["uppercase", "none"] as const),
    numerals: oneOf(raw, "numerals", where, ["oldstyle", "lining"] as const),
    quote: oneOf(raw, "quote", where, ["italic", "normal"] as const),
    ornament: str(raw, "ornament", where),
    code: str(raw, "code", where),
    ui: raw.ui === undefined || raw.ui === "body" ? list(raw, "body", where) : list(raw, "ui", where),
    headingCase: raw.headings === undefined ? "none" : oneOf(raw, "headings", where, ["none", "uppercase"] as const),
    linkLine: raw.links === undefined ? "always" : oneOf(raw, "links", where, ["always", "hover"] as const),
  };
}

export function parseScale(name: string, raw: Raw): Scale {
  const where = `scales/${name}.yaml`;
  const steps = pair(raw, "steps", where);
  const space = need(raw, "space", where);
  if (!Array.isArray(space) || space.some((s) => typeof s !== "number" && !(Array.isArray(s) && s.length === 2))) {
    throw new ThemeError(`${where}: "space" should be a list of sizes in rem, or [smallest, largest] pairs`);
  }
  return {
    name,
    description: str(raw, "description", where),
    screen: pair(raw, "screen", where),
    body: pair(raw, "body", where),
    ratio: pair(raw, "ratio", where),
    steps,
    space: space as Scale["space"],
    measure: str(raw, "measure", where),
    wide: str(raw, "wide", where),
    radius: str(raw, "radius", where),
    border: raw.border === undefined ? "1px" : str(raw, "border", where),
    controlRadius: raw.controls === undefined ? str(raw, "radius", where) : str(raw, "controls", where),
    rules: raw.rules === undefined ? "solid" : oneOf(raw, "rules", where, ["solid", "dashed", "dotted"] as const),
  };
}

export type Catalog = {
  dir: string;
  slots: string[];
  themes: Record<string, Theme>;
  palettes: Record<string, Palette>;
  pairings: Record<string, Pairing>;
  scales: Record<string, Scale>;
};

const readYaml = (path: string): Raw => (parse(readFileSync(path, "utf8")) ?? {}) as Raw;

export function load(dir: string): Catalog {
  const slots = readYaml(join(dir, "catalog.yaml")).slots as string[];
  const read = <T>(kind: Kind, make: (name: string, raw: Raw) => T) => {
    const out: Record<string, T> = {};
    const folder = join(dir, "themes", kind);
    for (const f of existsSync(folder) ? readdirSync(folder).sort() : []) {
      if (f.endsWith(".yaml")) out[f.slice(0, -5)] = make(f.slice(0, -5), readYaml(join(folder, f)));
    }
    return out;
  };
  const themesRaw = readYaml(join(dir, "themes.yaml"));
  const themes: Record<string, Theme> = {};
  for (const [name, t] of Object.entries(themesRaw)) {
    const r = t as Raw, where = `themes.yaml ${name}`;
    themes[name] = {
      name, description: str(r, "description", where), palette: str(r, "palette", where), pairing: str(r, "pairing", where), scale: str(r, "scale", where),
      ...(r.skin === undefined ? {} : { skin: str(r, "skin", where) }),
    };
  }
  return { dir, slots, themes, palettes: read("palettes", parsePalette), pairings: read("pairings", parsePairing), scales: read("scales", parseScale) };
}

// ── CSS ─────────────────────────────────────────────────────────────────

const round = (n: number, places = 4) => String(Number(n.toFixed(places)));
const rem = (px: number) => `${round(px / 16)}rem`;

// A size that grows from `min` px on the smallest screen to `max` px on the
// largest, the way Utopia's fluid scales do.
export function fluid(min: number, max: number, [s0, s1]: [number, number]): string {
  if (min === max) return rem(min);
  const slope = (max - min) / (s1 - s0);
  const intercept = min - slope * s0;
  return `clamp(${rem(min)}, ${round(intercept / 16, 3)}rem + ${round(slope * 100, 3)}vw, ${rem(max)})`;
}

// A CSS string literal, with anything outside ASCII escaped.
// A CSS escape ends at the first character that is not a hex digit, so a
// space is added after one only when the next character would run on.
export function cssString(s: string): string {
  const chars = [...s];
  let out = "";
  chars.forEach((ch, i) => {
    if (ch.codePointAt(0)! > 126) {
      out += `\\${ch.codePointAt(0)!.toString(16)}`;
      if (/[0-9a-f\s]/i.test(chars[i + 1] ?? "")) out += " ";
    } else out += ch === '"' || ch === "\\" ? `\\${ch}` : ch;
  });
  return `"${out}"`;
}

const family = (names: string[]) => names.map((n) => (/^[a-z-]+$/i.test(n) ? n : `"${n}"`)).join(", ");

const header = (kind: Kind, name: string, what: string) =>
  `/* ${what}\n   Made by \`bun scripts/theme.ts build\` from themes/${kind}/${name}.yaml.\n   Edit that file, not this one. */\n`;

const block = (vars: [string, string][], extra = "") =>
  `:root {\n${extra}${vars.map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}\n`;

export function paletteCss(p: Palette): string {
  const sc = hex(p.shadow.color).join(" "), k = p.shadow.strength;
  const a = (n: number) => round(Math.min(1, n * k), 3);
  const vars: [string, string][] = [
    ...Object.entries(p.colors),
    ["shadow-soft", `0 1px 2px rgb(${sc} / ${a(0.06)}), 0 2px 8px rgb(${sc} / ${a(0.05)})`],
    ["shadow-deep", `0 2px 4px rgb(${sc} / ${a(0.06)}), 0 16px 40px rgb(${sc} / ${a(0.14)})`],
  ];
  return header("palettes", p.name, `${p.name}: ${p.description}.`) + "\n" + block(vars, `  color-scheme: ${p.scheme};\n\n`);
}

export function pairingCss(p: Pairing): string {
  const faces = p.faces.map((f) =>
    `@font-face {\n  font-family: "${f.family}";\n  src: url("../fonts/${f.file}") format("woff2");\n  font-weight: ${f.weight[0] === f.weight[1] ? f.weight[0] : f.weight.join(" ")};\n  font-style: ${f.style};\n  font-display: swap;\n}\n`).join("");
  const vars: [string, string][] = [
    ["font-body", family(p.body)],
    ["font-display", family(p.display)],
    ["font-mono", family(p.mono)],
    ["font-ui", family(p.ui)],
    ["weight-body", String(p.weight.body)],
    ["weight-strong", String(p.weight.strong)],
    ["weight-heading", String(p.weight.heading)],
    ["weight-display", String(p.weight.display)],
    ["leading-body", String(p.leading.body)],
    ["leading-heading", String(p.leading.heading)],
    ["leading-display", String(p.leading.display)],
    ["tracking-body", p.tracking.body],
    ["tracking-display", p.tracking.display],
    ["tracking-label", p.tracking.label],
    ["label-case", p.labels],
    ["numerals", `${p.numerals}-nums`],
    ["quote-style", p.quote],
    ["ornament", cssString(p.ornament)],
    ["code-size", p.code],
    ["heading-case", p.headingCase],
    ["link-line", p.linkLine === "always" ? "underline" : "none"],
  ];
  return header("pairings", p.name, `${p.name}: ${p.description}.`) + "\n" + faces + "\n" + block(vars);
}

export function scaleCss(s: Scale): string {
  const vars: [string, string][] = [];
  for (let i = s.steps[0]; i <= s.steps[1]; i++) {
    vars.push([`step-${i}`, fluid(s.body[0] * s.ratio[0] ** i, s.body[1] * s.ratio[1] ** i, s.screen)]);
  }
  s.space.forEach((v, i) => vars.push([`space-${i + 1}`, Array.isArray(v) ? fluid(v[0] * 16, v[1] * 16, s.screen) : `${v}rem`]));
  vars.push(["measure", s.measure], ["wide", s.wide], ["radius", s.radius], ["border", s.border], ["control-radius", s.controlRadius], ["rule-style", s.rules]);
  const what = `${s.name}: ${s.description}. Body ${s.body[0]}px to ${s.body[1]}px, ratio ${s.ratio[0]} to ${s.ratio[1]}, from a ${s.screen[0]}px to a ${s.screen[1]}px screen.`;
  return header("scales", s.name, what) + "\n" + block(vars);
}

// Every generated file, by its path under the catalog folder.
export function outputs(cat: Catalog): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of Object.values(cat.palettes)) out[`assets/css/palettes/${p.name}.css`] = paletteCss(p);
  for (const p of Object.values(cat.pairings)) out[`assets/css/pairings/${p.name}.css`] = pairingCss(p);
  for (const s of Object.values(cat.scales)) out[`assets/css/scales/${s.name}.css`] = scaleCss(s);
  return out;
}

// ── checks ──────────────────────────────────────────────────────────────

export type Problem = { where: string; message: string; level: "error" | "warning" };

const AA = 4.5;

// Which text sits on which ground, by slot. `inside` says where on the page
// the pair is drawn, for the message.
const TEXT_PAIRS: [string, string, string][] = [
  ["ink", "paper", "the writing"],
  ["link", "paper", "links"],
  ["link", "tint", "links in a tinted box"],
  ["link", "accent-tint", "links in a callout on the accent's tint"],
  ["heading", "paper", "headings"],
  ["code-ink", "code-paper", "code blocks"],
  ["code-muted", "code-paper", "comments in code blocks"],
  ["code-accent", "code-paper", "keywords in code blocks"],
  ["positive", "paper", "marks for what went well"],
  ["warning", "paper", "warnings"],
  ["danger", "paper", "dangers"],
  ["positive", "positive-tint", "a tip's label"],
  ["warning", "warning-tint", "a warning's label"],
  ["danger", "danger-tint", "a danger's label"],
  ["ink", "danger-tint", "a danger callout"],
  ["muted", "paper", "bylines, captions, dates"],
  ["accent", "paper", "links on hover, footnote marks, labels"],
  ["ink", "tint", "a tinted box, code"],
  ["muted", "tint", "a callout's label"],
  ["accent", "tint", "keywords in code"],
  ["muted", "raised", "captions in a raised box"],
  ["ink", "accent-tint", "a warning callout"],
  ["accent", "accent-tint", "a warning callout's label"],
  ["ink", "raised", "a raised box"],
  ["heading", "tint", "a heading in a tinted box"],
  ["heading", "raised", "a heading in a raised box"],
  ["ink", "positive-tint", "a tip callout"],
  ["ink", "warning-tint", "a warning callout"],
  ["link", "positive-tint", "links in a tip callout"],
  ["link", "warning-tint", "links in a warning callout"],
  ["link", "danger-tint", "links in a danger callout"],
  ["paper", "ink", "a filled button"],
  ["paper", "accent", "a filled button, on hover"],
  ["dark-ink", "dark-paper", "a dark band"],
  ["band-ink", "band", "writing on a colored sidebar or header"],
  ["dark-link", "dark-paper", "links in a dark band"],
  ["dark-link", "dark-tint", "links in a tinted box in a dark band"],
  ["dark-heading", "dark-paper", "headings in a dark band"],
  ["dark-ink", "dark-raised", "a raised box in a dark band"],
  ["dark-muted", "dark-raised", "captions in a raised box in a dark band"],
  ["dark-muted", "dark-paper", "captions in a dark band"],
  ["dark-accent", "dark-paper", "quote marks, ornaments and links in a dark band"],
  ["dark-ink", "dark-tint", "a tinted box in a dark band"],
  ["dark-muted", "dark-tint", "code comments in a dark band"],
  ["dark-accent", "dark-tint", "keywords in code in a dark band"],
  ["dark-ink", "dark-accent-tint", "a warning callout in a dark band"],
  ["dark-accent", "dark-accent-tint", "a warning callout's label in a dark band"],
  ["dark-paper", "dark-accent", "a filled button in a dark band, on hover"],
  ["dark-heading", "dark-tint", "a heading in a tinted box in a dark band"],
  ["dark-ink", "dark-positive-tint", "a tip callout in a dark band"],
  ["dark-ink", "dark-warning-tint", "a warning callout in a dark band"],
  ["dark-ink", "dark-danger-tint", "a danger callout in a dark band"],
  ["dark-link", "dark-positive-tint", "links in a tip callout in a dark band"],
  ["dark-link", "dark-warning-tint", "links in a warning callout in a dark band"],
  ["dark-link", "dark-danger-tint", "links in a danger callout in a dark band"],
  ["dark-positive", "dark-paper", "marks for what went well in a dark band"],
  ["dark-link", "dark-accent-tint", "links in a warning callout in a dark band"],
  ["dark-link", "dark-raised", "links in a raised box in a dark band"],
  ["dark-positive", "dark-positive-tint", "a tip's label in a dark band"],
  ["dark-warning", "dark-warning-tint", "a warning's label in a dark band"],
  ["dark-danger", "dark-danger-tint", "a danger's label in a dark band"],
];

// Grounds that must read as different from the page, not just be different.
const APART: [string, string, number, string][] = [
  ["tint", "paper", 1.05, "a tinted box would not show against the page"],
  ["rule", "paper", 1.15, "rules and borders would be too faint to see"],
  ["dark-rule", "dark-paper", 1.15, "rules in a dark band would be too faint to see"],
];

export function checkPalette(p: Palette): Problem[] {
  const out: Problem[] = [];
  const where = `palettes/${p.name}.yaml`;
  const c = (k: string) => hex(p.colors[k]!);
  for (const [fg, bg, inside] of TEXT_PAIRS) {
    const r = contrast(c(fg), c(bg));
    if (r < AA) out.push({ where, level: "error", message: `${fg} on ${bg} (${inside}) has contrast ${r.toFixed(2)}, below ${AA}` });
  }
  // A code block's file name sits on the code's ground with a little of its ink
  // mixed in (parts/code.css), so that ground is not a slot of its own.
  for (const [fg, bg] of [["code-ink", "code-paper"], ["dark-ink", "dark-tint"]] as const) {
    const r = contrast(c(fg), mix(c(fg), c(bg), 0.08));
    if (r < AA) out.push({ where, level: "error", message: `${fg} on ${bg} (the name of a file above code, on a ground 8% toward the ink) has contrast ${r.toFixed(2)}, below ${AA}` });
  }
  for (const [a, b, min, why] of APART) {
    const r = contrast(c(a), c(b));
    if (r < min) out.push({ where, level: "warning", message: `${a} and ${b} are ${r.toFixed(2)} apart, under ${min}: ${why}` });
  }
  // On a dark page the band is another dark ground, so it can sit closer.
  const band = contrast(c("dark-paper"), c("paper")), least = p.scheme === "dark" ? 1.1 : 1.6;
  if (band < least) out.push({ where, level: "warning", message: `dark-paper and paper are ${band.toFixed(2)} apart, under ${least}: a dark band would not stand out from the page` });
  if (p.scheme === "dark" && contrast(c("paper"), [0, 0, 0]) > contrast(c("paper"), [255, 255, 255])) {
    out.push({ where, level: "warning", message: `scheme is dark, but paper is a light color` });
  }
  return out;
}

export function checkPairing(p: Pairing, fontsDir: string): Problem[] {
  const out: Problem[] = [];
  const where = `pairings/${p.name}.yaml`;
  for (const f of p.faces) {
    if (!existsSync(join(fontsDir, f.file))) out.push({ where, level: "error", message: `no font file ${f.file} in static/fonts/` });
  }
  for (const f of p.preload) {
    if (!p.faces.some((x) => x.file === f)) out.push({ where, level: "error", message: `preload names ${f}, which is not one of the faces` });
  }
  // A weight with no face to draw it is faked by the browser, or rounded to
  // the nearest face, and the page looks wrong in a way that is hard to see.
  if (p.faces.length === 0) return out;
  const families = new Set(p.faces.map((f) => f.family));
  const first = (names: string[]) => names.find((n) => families.has(n));
  const uses: [string, number, "normal" | "italic"][] = [
    ["body", p.weight.body, "normal"],
    ["body", p.weight.strong, "normal"],
    ["display", p.weight.heading, "normal"],
    ["display", p.weight.display, "normal"],
    ["body", p.weight.body, "italic"],
  ];
  if (p.quote === "italic") uses.push(["body", p.weight.body, "italic"]);
  for (const [role, w, style] of uses) {
    const fam = first(role === "body" ? p.body : p.display);
    if (!fam) {
      out.push({ where, level: "warning", message: `the ${role} font has no face here, so the reader's own fonts are used` });
      continue;
    }
    const ok = p.faces.some((f) => f.family === fam && f.style === style && f.weight[0] <= w && w <= f.weight[1]);
    if (!ok) out.push({ where, level: style === "italic" ? "warning" : "error", message: `${fam} has no ${style} face at weight ${w}; the browser would fake it` });
  }
  if (!p.preload.length) out.push({ where, level: "warning", message: `nothing is preloaded, so the first screen may draw in a fallback font` });
  return out;
}

export function checkScale(s: Scale): Problem[] {
  const out: Problem[] = [];
  const where = `scales/${s.name}.yaml`;
  if (s.body[0] < 16) out.push({ where, level: "warning", message: `body text under 16px on a phone is hard to read` });
  if (s.screen[0] >= s.screen[1]) out.push({ where, level: "error", message: `screen should go from the smallest to the largest` });
  if (s.steps[0] > -1 || s.steps[1] < 4) out.push({ where, level: "error", message: `steps should run from -1 to at least 4; the parts use all of them` });
  return out;
}

// The CSS a catalog's parts and page are written in may read slots and its
// own local variables, and never a literal color, font or weight: those
// belong to themes.
export function lint(cat: Catalog, files: Record<string, string>): Problem[] {
  const out: Problem[] = [];
  const slots = new Set(cat.slots);
  for (const [path, css] of Object.entries(files)) {
    const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!.slice(2)));
    const lines = css.split("\n");
    lines.forEach((line, i) => {
      const where = `${path}:${i + 1}`;
      const code = line.replace(/\/\*.*?\*\//g, "");
      for (const m of code.matchAll(/var\(--([a-z0-9-]+)/g)) {
        if (!slots.has(m[1]!) && !local.has(m[1]!)) out.push({ where, level: "error", message: `--${m[1]} is not a slot in catalog.yaml` });
      }
      if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(|\b(white|black)\b(?!-)/i.test(code)) {
        out.push({ where, level: "error", message: `a literal color; use a slot` });
      }
      if (/font-weight:\s*\d/.test(code)) out.push({ where, level: "error", message: `a literal font weight; use a weight slot` });
      if (/font-family:(?!\s*(var\(|inherit))/.test(code)) out.push({ where, level: "error", message: `a literal font; use a font slot` });
    });
  }
  return out;
}

export function check(cat: Catalog): Problem[] {
  const out: Problem[] = [];
  for (const [name, t] of Object.entries(cat.themes)) {
    const where = `themes.yaml ${name}`;
    if (!cat.palettes[t.palette]) out.push({ where, level: "error", message: `no palette "${t.palette}" in themes/palettes/` });
    if (!cat.pairings[t.pairing]) out.push({ where, level: "error", message: `no pairing "${t.pairing}" in themes/pairings/` });
    if (!cat.scales[t.scale]) out.push({ where, level: "error", message: `no scale "${t.scale}" in themes/scales/` });
    if (t.skin && !existsSync(join(cat.dir, "assets/css/skins", `${t.skin}.css`))) {
      out.push({ where, level: "error", message: `no skin "${t.skin}" in assets/css/skins/` });
    }
  }
  for (const p of Object.values(cat.palettes)) out.push(...checkPalette(p));
  for (const p of Object.values(cat.pairings)) out.push(...checkPairing(p, join(cat.dir, "static/fonts")));
  for (const s of Object.values(cat.scales)) out.push(...checkScale(s));

  // Together, one of each kind fills every slot, and nothing else.
  const defined = (css: string) => new Set([...css.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]!));
  const one = <T>(r: Record<string, T>) => Object.values(r)[0];
  const [pal, pai, sca] = [one(cat.palettes), one(cat.pairings), one(cat.scales)];
  if (pal && pai && sca) {
    const filled = new Set([...defined(paletteCss(pal)), ...defined(pairingCss(pai)), ...defined(scaleCss(sca))]);
    for (const s of cat.slots) if (!filled.has(s)) out.push({ where: "catalog.yaml", level: "error", message: `no piece fills the slot "${s}"` });
    for (const s of filled) if (!cat.slots.includes(s)) out.push({ where: "catalog.yaml", level: "error", message: `"${s}" is filled by a theme but is not listed in slots` });
  }

  const cssDir = join(cat.dir, "assets/css");
  const shared: Record<string, string> = { "assets/css/base.css": readFileSync(join(cssDir, "base.css"), "utf8") };
  for (const f of readdirSync(join(cssDir, "parts")).sort()) shared[`assets/css/parts/${f}`] = readFileSync(join(cssDir, "parts", f), "utf8");
  const skins = join(cssDir, "skins");
  for (const f of existsSync(skins) ? readdirSync(skins).sort() : []) shared[`assets/css/skins/${f}`] = readFileSync(join(skins, f), "utf8");
  out.push(...lint(cat, shared));

  for (const [path, css] of Object.entries(outputs(cat))) {
    const file = join(cat.dir, path);
    if (!existsSync(file) || readFileSync(file, "utf8") !== css) {
      out.push({ where: path, level: "error", message: `out of date; run bun scripts/theme.ts build` });
    }
  }
  return out;
}
