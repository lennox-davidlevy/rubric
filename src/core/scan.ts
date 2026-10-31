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
  // The closing fence's line, or undefined when the block is never closed.
  close?: number;
  // Index into Scan.directives of the enclosing block.
  parent?: number;
  // Problems with the line itself: a bad pin or a plain form that fails
  // validation. A directive with problems is never placed.
  problems: Diagnostic[];
}

export interface Scan {
  directives: Directive[];
  strayClosers: number[];
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
  const open: number[] = [];
  let fence: { char: string; length: number } | undefined;

  let i = frontMatterEnd(src);
  for (; i < src.length; i++) {
    const line = src[i]!;

    const code = CODE_FENCE.exec(line);
    if (fence) {
      if (code && code[1]![0] === fence.char && code[1]!.length >= fence.length && code[2]!.trim() === "") fence = undefined;
      continue;
    }
    if (code && !(code[1]![0] === "`" && code[2]!.includes("`"))) {
      fence = { char: code[1]![0]!, length: code[1]!.length };
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

  return { directives, strayClosers };
}

function classify(text: string, col: number, line: number, catalog: Catalog): Directive {
  const pin = text.lastIndexOf(PIN);
  if (pin !== -1) {
    const words = text.slice(0, pin).trim();
    const rightCol = col + pin + PIN.length;
    const plain = parsePlain(text.slice(pin + PIN.length), rightCol);
    if (!plain) {
      const problem: Diagnostic = {
        line, start: rightCol, end: col + text.length, code: "bad-pin",
        message: "the text after -> is not a plain form: a part name, then key=value settings",
      };
      return { line, kind: "pinned", words, problems: [problem] };
    }
    return { line, kind: "pinned", words, plain, problems: validatePlain(plain, catalog, line) };
  }

  const plain = parsePlain(text, col);
  if (isPlain(plain, catalog)) return { line, kind: "plain", plain, problems: validatePlain(plain, catalog, line) };
  return { line, kind: "words", words: text, problems: [] };
}

// Front matter is the writer's metadata, never page content.
function frontMatterEnd(src: string[]): number {
  const delim = src[0]?.trimEnd();
  if (delim !== "---" && delim !== "+++") return 0;
  for (let i = 1; i < src.length; i++) if (src[i]!.trimEnd() === delim) return i + 1;
  return 0;
}
