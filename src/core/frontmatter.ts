// Whether a page's front matter parses. While the writer is mid-way through
// a line such as `hide: [comments`, it does not, and a page Hugo cannot read
// leaves Hugo's dev server in a state its next rebuild crashes on (Hugo
// 0.169, with taxonomies: "Shift: unknown type *hugolib.pageMetaSource").
// So a page is written only when its front matter parses.

import { parse } from "yaml";
import { lines as splitLines } from "./scan.ts";
import type { Diagnostic } from "./diagnostic.ts";

export function frontMatterProblem(text: string): Diagnostic | undefined {
  const src = splitLines(text);
  const delim = src[0]?.trimEnd();
  if (delim !== "---" && delim !== "+++") return undefined;
  let end = -1;
  for (let i = 1; i < src.length; i++) if (src[i]!.trimEnd() === delim) { end = i; break; }
  if (end === -1) return undefined;
  const body = src.slice(1, end).join("\n");
  let line = 0;
  let reason: string | undefined;
  try {
    const data = delim === "---" ? parse(body) : Bun.TOML.parse(body);
    if (data !== null && data !== undefined && (typeof data !== "object" || Array.isArray(data))) reason = "it is not a list of key: value lines";
  } catch (err) {
    const e = err as { message?: string; linePos?: [{ line: number }]; line?: number };
    line = e.linePos?.[0]?.line ?? e.line ?? 0;
    reason = (e.message ?? String(err)).split("\n")[0]!.replace(/ at line \d+, column \d+:?$/, "");
  }
  if (reason === undefined) return undefined;
  const at = Math.min(Math.max(line, 1), end - 1 || 1);
  return {
    line: at,
    start: 0,
    end: src[at]?.length ?? 0,
    code: "bad-front-matter",
    message: `the front matter does not parse yet, so the page shows its last good version: ${reason}`,
  };
}
