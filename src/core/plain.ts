// The plain form: `quote size=large align=center cite="J. R. R. Tolkien"`.
// A part name followed by key=value settings, where a value with spaces is in
// double quotes. Plain form is the source of truth; words resolve to it.

import { NAME, settingsOf, type Catalog } from "./catalog.ts";
import type { Diagnostic } from "./diagnostic.ts";

export interface Span {
  start: number;
  end: number;
}

export interface PlainSetting {
  key: string;
  value: string;
  keySpan: Span;
  valueSpan: Span;
}

export interface PlainForm {
  part: string;
  partSpan: Span;
  settings: PlainSetting[];
}

const TOKEN = /([a-z][a-z0-9-]*)="([^"]*)"|([^\s"]+)/y;

// Reads text as a plain form, or returns undefined when it is not shaped like
// one. `offset` is the column the text starts at, so spans are line columns.
// The part name is not checked against the catalog here; see isPlain.
export function parsePlain(text: string, offset = 0): PlainForm | undefined {
  const tokens: { quoted?: [string, string]; bare?: string; span: Span }[] = [];
  let pos = 0;
  while (true) {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
    if (pos >= text.length) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) return undefined;
    const span = { start: offset + pos, end: offset + pos + m[0].length };
    tokens.push(m[3] === undefined ? { quoted: [m[1]!, m[2]!], span } : { bare: m[3], span });
    pos = TOKEN.lastIndex;
  }

  const [first, ...rest] = tokens;
  if (!first?.bare || !NAME.test(first.bare)) return undefined;

  const settings: PlainSetting[] = [];
  for (const t of rest) {
    if (t.quoted) {
      const [key, value] = t.quoted;
      const keySpan = { start: t.span.start, end: t.span.start + key.length };
      settings.push({ key, value, keySpan, valueSpan: { start: keySpan.end + 1, end: t.span.end } });
      continue;
    }
    const eq = t.bare!.indexOf("=");
    const key = t.bare!.slice(0, eq);
    const value = t.bare!.slice(eq + 1);
    if (eq < 1 || !NAME.test(key) || value === "") return undefined;
    const keySpan = { start: t.span.start, end: t.span.start + key.length };
    settings.push({ key, value, keySpan, valueSpan: { start: keySpan.end + 1, end: t.span.end } });
  }
  return { part: first.bare, partSpan: first.span, settings };
}

// A directive line is plain form when its first token is a part in the
// catalog, or in another skin's, and every remaining token is key=value.
// Anything else is words.
export function isPlain(form: PlainForm | undefined, catalog: Catalog): form is PlainForm {
  return form !== undefined && (Object.hasOwn(catalog.parts, form.part) || Object.hasOwn(catalog.elsewhere.parts, form.part));
}

// Problems with a plain form. A part or a setting another skin adds is an
// "other-skin" note, not a mistake: switching skins never breaks a page.
export function validatePlain(form: PlainForm, catalog: Catalog, line: number): Diagnostic[] {
  const part = Object.hasOwn(catalog.parts, form.part) ? catalog.parts[form.part] : undefined;
  if (!part) {
    const skin = catalog.elsewhere.parts[form.part];
    if (skin) return [{ line, ...form.partSpan, code: "other-skin", message: `${form.part} comes with the ${skin} skin; this site's theme doesn't draw it` }];
    return [{ line, ...form.partSpan, code: "unknown-part", message: `"${form.part}" is not a part in the ${catalog.name} catalog` }];
  }

  const defs = settingsOf(catalog, form.part);
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const s of form.settings) {
    const def = Object.hasOwn(defs, s.key) ? defs[s.key] : undefined;
    if (!def) {
      const skin = catalog.elsewhere.settings[form.part]?.[s.key];
      out.push(skin
        ? { line, ...s.keySpan, code: "other-skin", message: `${s.key} comes with the ${skin} skin; this site's theme leaves it out and keeps it in the pin` }
        : { line, ...s.keySpan, code: "unknown-setting", message: `${form.part} has no setting "${s.key}"` });
      continue;
    }
    if (seen.has(s.key)) {
      out.push({ line, ...s.keySpan, code: "duplicate-setting", message: `${s.key} is given more than once` });
      continue;
    }
    seen.add(s.key);

    const allowed =
      def.type === "choice" ? Object.keys(def.values)
      : def.type === "level" ? Object.keys(def.levels)
      : def.type === "flag" ? ["true", "false"]
      : undefined;
    const ok =
      allowed ? allowed.includes(s.value)
      : def.type === "number" ? Number.isFinite(Number(s.value))
      : true;
    if (!ok) {
      const what = allowed ? `allowed: ${allowed.join(", ")}` : "it must be a number";
      out.push({ line, ...s.valueSpan, code: "value-not-allowed", message: `"${s.value}" is not allowed for ${s.key}; ${what}` });
    }
  }
  return out;
}

// The plain form as text, with values quoted only where they need it.
export function formatPlain(form: { part: string; settings: readonly { key: string; value: string }[] }): string {
  return [form.part, ...form.settings.map((s) => `${s.key}=${/^[^\s"]+$/.test(s.value) ? s.value : `"${s.value}"`}`)].join(" ");
}

export function openShortcode(form: PlainForm): string {
  return `{{< ${[form.part, ...form.settings.map((s) => `${s.key}="${s.value}"`)].join(" ")} >}}`;
}

// A part that takes nothing inside: one call, closed in itself.
export function aloneShortcode(form: PlainForm): string {
  return openShortcode(form).replace(/ >\}\}$/, " />}}");
}

export function closeShortcode(form: PlainForm): string {
  return `{{< /${form.part} >}}`;
}
