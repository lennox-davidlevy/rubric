// Splits a page into directive blocks. Detection is free: a line starting with
// `:::` is a directive unless it is inside a code fence or the front matter.
// Each opening line is classified as pinned, plain or words.

import type { Catalog } from "./catalog.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { isPlain, parsePlain, validatePlain, type PlainForm } from "./plain.ts";

export type Kind = "pinned" | "plain" | "words";

export interface Directive {
  line: number;
  kind: Kind;
  // The words, for pinned and words lines.
  words?: string;
  // The plain form, for plain lines and pins whose right side parses.
  plain?: PlainForm;
  // Words after a lone ":" that follows a plain form: what to change about
  // the part, asked of Jev only about that part's settings. The part is
  // never asked again. `colon` is the column of the ":", `start` of the words.
  refine?: Refine;
  // The closing fence's line, or undefined when the block is never closed.
  close?: number;
  // Index into Scan.directives of the enclosing block.
  parent?: number;
  // Problems with the line itself: a bad pin or a plain form that fails
  // validation. A directive with problems is never placed.
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
const PIN = " -> ";

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
    directives.push({ ...classify(m[2]!, col, i, catalog), ...(parent === undefined ? {} : { parent }) });
    open.push(directives.length - 1);
  }

  return { directives, strayClosers, code };
}

function classify(text: string, col: number, line: number, catalog: Catalog): Directive {
  // The pin is the first " -> " whose right side reads as a plain form, so
  // words may hold an arrow of their own; with none, the last one is the pin.
  const pins = [...text.matchAll(/ -> /g)].map((m) => m.index);
  const pin = pins.find((p) => parsePlain(splitRefine(text.slice(p + PIN.length), 0).plain) !== undefined) ?? pins.at(-1);
  if (pin !== undefined) {
    const words = text.slice(0, pin).trim();
    const rightCol = col + pin + PIN.length;
    const { plain: right, refine } = splitRefine(text.slice(pin + PIN.length), rightCol);
    const plain = parsePlain(right, rightCol);
    if (!plain) {
      const problem: Diagnostic = {
        line, start: rightCol, end: col + text.length, code: "bad-pin",
        message: "the text after -> is not a plain form: a part name, then key=value settings",
      };
      return { line, kind: "pinned", words, problems: [problem] };
    }
    return { line, kind: "pinned", words, plain, ...(refine ? { refine } : {}), problems: validatePlain(plain, catalog, line) };
  }

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
