// What the live preview adds to a page's content, and only the live preview:
// the language server writes it, `rubric build` never does. Both shortcodes
// it adds draw nothing outside `hugo server`.
//
// - A marker before each block at the top of the page, with the source line
//   it starts on, so the preview can scroll to where the writer's cursor is:
//   {{< rubric-line 12 >}}. Only where a block starts after a blank line, so
//   no list, paragraph or part is split by it; inside a part, the part's own
//   marker stands for every line in it.
// - The starter body in a block that is still empty, so a part Jev has
//   placed shows its shape before anything is written in it, faded:
//   {{< rubric-line 12 "starter" >}}.
//
// The content keeps every line it had, in order; the markers are lines added
// between them.

import type { Catalog } from "./catalog.ts";
import type { Output } from "./preprocess.ts";
import { frontMatterEnd, lines as splitLines, scan } from "./scan.ts";

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

export function liveContent(text: string, out: Output, catalog: Catalog): string {
  const src = splitLines(text);
  const content = out.content.split("\n");
  const { directives, code } = scan(text, catalog);
  const start = frontMatterEnd(src);

  // Lines inside a top-level block, its fences included, and where each
  // top-level block opens.
  const inside = new Set<number>();
  const opens = new Map<number, number>();
  directives.forEach((d, i) => {
    if (d.parent !== undefined || d.close === undefined) return;
    opens.set(d.line, i);
    for (let l = d.line; l <= d.close; l++) inside.add(l);
  });

  const blank = (l: number) => l < start || (src[l] ?? "").trim() === "";
  const lastText = (l: number) => {
    for (let k = l - 1; k >= start; k--) if (!blank(k)) return src[k]!;
    return undefined;
  };
  const marks = (l: number): boolean => {
    const line = src[l]!;
    if (l < start || line.trim() === "" || !blank(l - 1)) return false;
    if (/^\s/.test(line)) return false;
    // Inside a part only its opening line; in code only the opening fence.
    if (inside.has(l) && !opens.has(l)) return false;
    if (code.has(l) && code.has(l - 1) && l - 1 >= start) return false;
    // A list's later items belong to it: a marker between them would make
    // two lists of one.
    const before = lastText(l);
    if (LIST_ITEM.test(line) && before !== undefined && (LIST_ITEM.test(before) || /^\s/.test(before))) return false;
    return true;
  };

  const result: string[] = [];
  for (let l = 0; l < content.length; l++) {
    const at = opens.get(l);
    const d = at === undefined ? undefined : directives[at]!;
    const entry = d && out.entries[at!];
    const part = entry?.placed && entry.plain ? catalog.parts[entry.plain.split(/\s/)[0]!] : undefined;
    const empty = d?.close !== undefined && src.slice(l + 1, d.close).every((x) => x.trim() === "");
    const marked = marks(l);
    // Only where it can be faded: a starter that read as the writer's own
    // words would mislead.
    const starter = marked && part?.body && empty ? part.body.replace(/\n+$/, "") : undefined;

    if (marked) result.push(`{{< rubric-line ${l}${starter ? ` "starter"` : ""} >}}`, "");
    result.push(content[l]!);
    if (starter && d?.close !== undefined) {
      result.push(...starter.split("\n"));
      // The empty lines it replaces.
      l = d.close - 1;
    }
  }
  return result.join("\n");
}
