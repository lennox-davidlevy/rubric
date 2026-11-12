// Writes Hugo content from a page. A placed directive's opening line becomes
// one shortcode call and its closing fence the closing call; every other line
// is copied byte for byte, so line N of the content is line N of the source.
// A directive that is not placed is left as its fence lines in plain text, so
// it shows in the preview and nothing is silently lost.

import type { Catalog, Place } from "./catalog.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { aloneShortcode, closeShortcode, formatPlain, openShortcode, validatePlain, type PlainForm } from "./plain.ts";
import { scan, type Kind } from "./scan.ts";
import { formatThemeLine, type ThemeChoice } from "./theme-line.ts";

// Why a directive was left as text. "unresolved" is a words line with no
// answer yet; the others carry a diagnostic.
export type Reason = "unresolved" | "invalid" | "unclosed" | "no-children" | "wrong-place";

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
  // The theme chosen in rubric.md, when one is.
  theme?: ThemeChoice;
}

// Looks up the plain form a words line resolved to: the cache, in the server.
// For a `new` line, the draft made for it, if there is one yet.
export type Resolve = (words: string, kind?: "words" | "new") => PlainForm | undefined;

// `place` is where the text is: a page ("writing") or rubric.md ("site"). A
// part chosen in the other place is left as text, with a diagnostic.
export function preprocess(text: string, catalog: Catalog, resolve: Resolve = () => undefined, place: Place = "writing"): Output {
  const { directives, strayClosers } = scan(text, catalog);
  const raw = text.split("\n");
  const out = [...raw];
  const set = (i: number, line: string) => (out[i] = raw[i]!.endsWith("\r") ? `${line}\r` : line);
  const whole = (i: number) => ({ line: i, start: 0, end: raw[i]!.replace(/\r$/, "").length });

  const diagnostics: Diagnostic[] = [];
  const forms: (PlainForm | undefined)[] = [];
  const entries: Entry[] = [];
  let theme: ThemeChoice | undefined;

  for (const d of directives) {
    if (d.kind === "theme") {
      const entry: Entry = { line: d.line, kind: "theme", placed: false };
      if (!d.theme!.words && Object.keys(d.theme!.choice).length > 0) entry.plain = formatThemeLine(d.theme!.choice);
      entries.push(entry);
      forms.push(undefined);
      if (place !== "site") {
        entry.reason = "wrong-place";
        diagnostics.push({ ...whole(d.line), code: "wrong-place", message: "the theme is the whole site's: choose it in rubric.md" });
      } else if (d.problems.length > 0) {
        entry.reason = "invalid";
        diagnostics.push(...d.problems);
      } else if (d.theme!.words || Object.keys(d.theme!.choice).length === 0) {
        entry.reason = "unresolved";
        diagnostics.push({ ...whole(d.line), code: "theme-unpicked", message: "no theme chosen yet: open the list on this line (the accept key, or :Rubric theme)" });
      } else if (theme) {
        entry.reason = "invalid";
        diagnostics.push({ ...whole(d.line), code: "second-theme", message: "the site already has a theme, chosen above; this line is not used" });
      } else {
        entry.placed = true;
        theme = d.theme!.choice;
      }
      continue;
    }
    let form = d.plain;
    let problems = d.problems;
    if (!form && (d.kind === "words" || d.kind === "new") && d.words !== undefined) {
      form = resolve(d.words, d.kind);
      // A cached pick the catalog no longer allows. Its spans point into the
      // cached text, not the line, so the whole line is marked instead.
      if (form) {
        const picked = formatPlain(form);
        problems = validatePlain(form, catalog, d.line, d.kind === "new").map((p) => ({
          ...p, ...whole(d.line), message: `the pick for these words, ${picked}, no longer fits the catalog: ${p.message}`,
        }));
      }
    }
    // Settings another skin adds are kept in the pin but left out of the
    // page, with a note; the part still draws. A part another skin adds
    // does not draw at all.
    const notes = problems.filter((p) => p.code === "other-skin");
    if (form && notes.length > 0 && notes.length === problems.length && Object.hasOwn(catalog.parts, form.part)) {
      const elsewhere = catalog.elsewhere.settings[form.part] ?? {};
      form = { ...form, settings: form.settings.filter((s) => !Object.hasOwn(elsewhere, s.key)) };
      diagnostics.push(...notes);
      problems = [];
    }
    forms.push(form);

    const wrongPlace = form && Object.hasOwn(catalog.parts, form.part) && catalog.parts[form.part]!.place !== place;

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

    // Takes nothing inside: from the line, or from what its words picked.
    const empty = form !== undefined && Object.hasOwn(catalog.parts, form.part) && catalog.parts[form.part]!.empty === true;

    if (d.close === undefined && !d.alone) {
      entry.reason = "unclosed";
      diagnostics.push({ ...whole(d.line), code: "unclosed-block", message: "this block has no closing ::: line" });
    } else if (wrongPlace) {
      entry.reason = "wrong-place";
      const at = d.plain ? { line: d.line, ...form!.partSpan } : whole(d.line);
      diagnostics.push({
        ...at,
        code: "wrong-place",
        message: place === "writing"
          ? `${form!.part} is part of the frame around every page: choose it in rubric.md`
          : `${form!.part} goes in a page; rubric.md holds the frame around every page, such as the header, footer and sidebar`,
      });
    } else if (problems.length > 0) {
      entry.reason = "invalid";
      diagnostics.push(...problems);
    } else if (!form) {
      entry.reason = "unresolved";
    } else if (parentPart && !parentPart.children) {
      entry.reason = "no-children";
      diagnostics.push({ ...whole(d.line), code: "no-children", message: `a directive cannot go inside a ${parentForm!.part}` });
    } else {
      entry.placed = true;
      if (empty) {
        // Words that picked such a part had a block: what's in it stays
        // as writing, after the part, and its closer goes.
        set(d.line, aloneShortcode(form));
        if (d.close !== undefined) set(d.close, "");
      } else {
        set(d.line, openShortcode(form));
        set(d.close!, closeShortcode(form));
      }
    }
  }

  for (const i of strayClosers) {
    // Most often the closer of a part that takes nothing inside, from before
    // such parts had none, or typed by habit.
    let above = i - 1;
    while (above >= 0 && raw[above]!.trim() === "") above--;
    const alone = directives.find((d) => d.line === above && d.alone && d.kind === "plain");
    const message = alone ? `${alone.plain!.part} takes nothing inside, so it has no closing :::` : "this ::: closes no block";
    diagnostics.push({ ...whole(i), code: "stray-closer", message });
  }
  diagnostics.sort((a, b) => a.line - b.line || a.start - b.start);

  return { content: out.join("\n"), entries, diagnostics, ...(theme ? { theme } : {}) };
}
