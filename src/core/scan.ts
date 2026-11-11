// Splits a page into directive blocks. Detection is free: a line starting with
// `:::` is a directive unless it is inside a code fence or the front matter.
// Each opening line is classified as plain or words.

import type { Catalog } from "./catalog.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { isPlain, parsePlain, validatePlain, type PlainForm } from "./plain.ts";
import { isThemeLine, parseThemeLine, type ThemeLine } from "./theme-line.ts";

// A theme line (`::: theme paper`, rubric.md only) chooses the site's theme;
// it has no body and no closing fence.
export type Kind = "plain" | "words" | "theme";

export interface Directive {
  line: number;
  kind: Kind;
  // The words, for words lines.
  words?: string;
  // The plain form, for plain lines.
  plain?: PlainForm;
  // Words after a lone ":" that follows a plain form: what to change about
  // the part, asked of Jev only about that part's settings. The part is
  // never asked again. `colon` is the column of the ":", `start` of the words.
  refine?: Refine;
  // The theme chosen, for a theme line.
  theme?: ThemeLine;
  // A line with no block: a theme line, or a part that takes nothing inside
  // (`::: divider`). It never has a closing fence.
  alone?: true;
  // The closing fence's line, or undefined when the block is never closed.
  close?: number;
  // Index into Scan.directives of the enclosing block.
  parent?: number;
  // Problems with the line itself: a plain form that fails validation, or
  // one still being typed. A directive with problems is never placed.
  problems: Diagnostic[];
}

export interface Refine {
  words: string;
  colon: number;
  start: number;
}

export interface Scan {
  directives: Directive[];
  strayClosers: number[];
  // Lines that are never directives: front matter and code, fences included.
  code: Set<number>;
}

const OPEN = /^(:{3,})\s*(\S.*?)\s*$/;
const CLOSE = /^:{3,}\s*$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function lines(text: string): string[] {
  return text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

export function scan(text: string, catalog: Catalog): Scan {
  const src = lines(text);
  const directives: Directive[] = [];
  const strayClosers: number[] = [];
  const code = new Set<number>();
  const open: number[] = [];
  let fence: { char: string; length: number } | undefined;

  let i = frontMatterEnd(src);
  for (let j = 0; j < i; j++) code.add(j);
  for (; i < src.length; i++) {
    const line = src[i]!;

    const f = CODE_FENCE.exec(line);
    if (fence) {
      code.add(i);
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.length && f[2]!.trim() === "") fence = undefined;
      continue;
    }
    if (f && !(f[1]![0] === "`" && f[2]!.includes("`"))) {
      code.add(i);
      fence = { char: f[1]![0]!, length: f[1]!.length };
      continue;
    }

    if (CLOSE.test(line)) {
      const opener = open.pop();
      if (opener === undefined) strayClosers.push(i);
      else directives[opener]!.close = i;
      continue;
    }

    const m = OPEN.exec(line);
    if (!m) continue;
    const parent = open.at(-1);
    const col = line.indexOf(m[2]!, m[1]!.length);
    if (isThemeLine(m[2]!, catalog.themes)) {
      const { theme, problems } = parseThemeLine(m[2]!, col, i, catalog.themes!);
      directives.push({ line: i, kind: "theme", theme, problems, alone: true, ...(parent === undefined ? {} : { parent }) });
      continue;
    }
    const d = classify(m[2]!, col, i, catalog);
    // A part that takes nothing inside opens no block. Words open one until
    // they are a part: what they'll be isn't known yet.
    // So does one with a setting still being typed (`::: divider style=`).
    const named = d.plain?.part ?? (d.problems[0]?.code === "unfinished-setting" ? m[2]!.split(/\s+/)[0] : undefined);
    if (named !== undefined && Object.hasOwn(catalog.parts, named) && catalog.parts[named]!.empty) d.alone = true;
    directives.push({ ...d, ...(parent === undefined ? {} : { parent }) });
    if (!d.alone) open.push(directives.length - 1);
  }

  return { directives, strayClosers, code };
}

// A line is plain form when it starts with a part; anything else is words,
// for Jev. Accepting Jev's pick puts the plain form in place of the words.
function classify(text: string, col: number, line: number, catalog: Catalog): Directive {
  const split = splitRefine(text, col);
  const plain = parsePlain(split.plain, col);
  if (isPlain(plain, catalog)) {
    return { line, kind: "plain", plain, ...(split.refine ? { refine: split.refine } : {}), problems: validatePlain(plain, catalog, line) };
  }
  const unfinished = unfinishedPlain(text, col, line, catalog);
  if (unfinished) return { line, kind: "plain", problems: [unfinished] };
  return { line, kind: "words", words: text, problems: [] };
}

// Splits a plain form from the words after its lone ":", if any. A colon
// inside a value (to=https://…, cite="Ch. 2: Home") is part of the value.
export function splitRefine(text: string, col: number): { plain: string; refine?: Refine } {
  for (const m of text.matchAll(/[a-z][a-z0-9-]*="[^"]*"|\S+/g)) {
    if (m[0] !== ":") continue;
    const after = text.slice(m.index + 1);
    const lead = after.length - after.trimStart().length;
    return { plain: text.slice(0, m.index).trimEnd(), refine: { words: after.trim(), colon: col + m.index, start: col + m.index + 1 + lead } };
  }
  return { plain: text };
}

// A plain form still being typed: `quot`, or `quote size=large ci`. It is not
// words, so it is never sent to Jev. Words may start with a part name ("quote
// from the book"), so only a setting's "=" or a lone part-name prefix count.
function unfinishedPlain(text: string, col: number, line: number, catalog: Catalog): Diagnostic | undefined {
  const names = Object.keys(catalog.parts);
  const tokens = text.split(/\s+/);
  const first = tokens[0]!;
  const whole = { line, start: col, end: col + text.length };
  if (tokens.length === 1 && names.some((n) => n.startsWith(first))) {
    return { ...whole, code: "unfinished-part", message: `"${first}" is not a part; the parts are ${names.join(", ")}` };
  }
  if (Object.hasOwn(catalog.parts, first) && tokens.some((t) => t.includes("="))) {
    return { ...whole, code: "unfinished-setting", message: "each setting is key=value, with a value that has spaces in double quotes" };
  }
  return undefined;
}

// Front matter is the writer's metadata, never page content.
export function frontMatterEnd(src: string[]): number {
  const delim = src[0]?.trimEnd();
  if (delim !== "---" && delim !== "+++") return 0;
  for (let i = 1; i < src.length; i++) if (src[i]!.trimEnd() === delim) return i + 1;
  return 0;
}
