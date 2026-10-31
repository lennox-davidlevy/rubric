// Writes Hugo content from a page. A placed directive's opening line becomes
// one shortcode call and its closing fence the closing call; every other line
// is copied byte for byte, so line N of the content is line N of the source.
// A directive that is not placed is left as its fence lines in plain text, so
// it shows in the preview and nothing is silently lost.

import type { Catalog } from "./catalog.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { closeShortcode, formatPlain, openShortcode, validatePlain, type PlainForm } from "./plain.ts";
import { scan, type Kind } from "./scan.ts";

// Why a directive was left as text. "unresolved" is a words line with no
// answer yet; the others carry a diagnostic.
export type Reason = "unresolved" | "invalid" | "bad-pin" | "unclosed" | "no-children";

// What each directive became and why: the sidecar, for the editor and for
// re-resolving later.
export interface Entry {
  line: number;
  close?: number;
  kind: Kind;
  words?: string;
  plain?: string;
  placed: boolean;
  reason?: Reason;
}

export interface Output {
  content: string;
  entries: Entry[];
  diagnostics: Diagnostic[];
}

// Looks up the plain form a words line resolved to: the cache, in the server.
export type Resolve = (words: string) => PlainForm | undefined;

export function preprocess(text: string, catalog: Catalog, resolve: Resolve = () => undefined): Output {
  const { directives, strayClosers } = scan(text, catalog);
  const raw = text.split("\n");
  const out = [...raw];
  const set = (i: number, line: string) => (out[i] = raw[i]!.endsWith("\r") ? `${line}\r` : line);
  const whole = (i: number) => ({ line: i, start: 0, end: raw[i]!.replace(/\r$/, "").length });

  const diagnostics: Diagnostic[] = [];
  const forms: (PlainForm | undefined)[] = [];
  const entries: Entry[] = [];

  for (const d of directives) {
    let form = d.plain;
    let problems = d.problems;
    if (!form && d.kind === "words" && d.words !== undefined) {
      form = resolve(d.words);
      // A cached pick the catalog no longer allows. Its spans point into the
      // cached text, not the line, so the whole line is marked instead.
      if (form) {
        const picked = formatPlain(form);
        problems = validatePlain(form, catalog, d.line).map((p) => ({
          ...p, ...whole(d.line), message: `the pick for these words, ${picked}, no longer fits the catalog: ${p.message}`,
        }));
      }
    }
    forms.push(form);

    const entry: Entry = {
      line: d.line,
      ...(d.close === undefined ? {} : { close: d.close }),
      kind: d.kind,
      ...(d.words === undefined ? {} : { words: d.words }),
      ...(form ? { plain: formatPlain(form) } : {}),
      placed: false,
    };
    entries.push(entry);

    const parentForm = d.parent === undefined ? undefined : forms[d.parent];
    const parentPart = parentForm && catalog.parts[parentForm.part];

    if (d.close === undefined) {
      entry.reason = "unclosed";
      diagnostics.push({ ...whole(d.line), code: "unclosed-block", message: "this block has no closing ::: line" });
    } else if (problems.length > 0) {
      entry.reason = problems.some((p) => p.code === "bad-pin") ? "bad-pin" : "invalid";
      diagnostics.push(...problems);
    } else if (!form) {
      entry.reason = "unresolved";
    } else if (parentPart && !parentPart.children) {
      entry.reason = "no-children";
      diagnostics.push({ ...whole(d.line), code: "no-children", message: `a directive cannot go inside a ${parentForm!.part}` });
    } else {
      entry.placed = true;
      set(d.line, openShortcode(form));
      set(d.close, closeShortcode(form));
    }
  }

  for (const i of strayClosers) {
    diagnostics.push({ ...whole(i), code: "stray-closer", message: "this ::: closes no block" });
  }
  diagnostics.sort((a, b) => a.line - b.line || a.start - b.start);

  return { content: out.join("\n"), entries, diagnostics };
}
