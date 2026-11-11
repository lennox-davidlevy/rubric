// The frame around every page, from rubric.md: each placed `:::` block there
// becomes one entry, with its settings (defaults filled in) and the Markdown
// inside it. The server writes the list into a page Hugo never publishes,
// content/rubric-frame/index.md, and the layout draws each entry in its place.

import type { Catalog } from "./catalog.ts";
import { parsePlain } from "./plain.ts";
import { preprocess, type Output, type Resolve } from "./preprocess.ts";
import type { ThemeChoice } from "./theme-line.ts";

export interface FrameEntry {
  part: string;
  settings: Record<string, string>;
  body: string;
}

export const FRAME_PAGE = "rubric-frame/index.md";

export function frame(text: string, catalog: Catalog, resolve: Resolve): { entries: FrameEntry[]; output: Output } {
  const output = preprocess(text, catalog, resolve, "site");
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const entries: FrameEntry[] = [];
  for (const e of output.entries) {
    if (!e.placed || e.plain === undefined) continue;
    const form = parsePlain(e.plain);
    const part = form && catalog.parts[form.part];
    if (!form || !part) continue;
    if (e.close === undefined && !part.empty) continue;
    const settings: Record<string, string> = {};
    for (const [name, def] of Object.entries(part.settings)) {
      const given = form.settings.find((s) => s.key === name)?.value;
      const fallback = "default" in def && def.default !== undefined ? String(def.default) : "";
      settings[name] = given ?? fallback;
    }
    // A part that takes nothing inside has no body, even when its words had a block.
    const body = part.empty || e.close === undefined ? "" : lines.slice(e.line + 1, e.close).join("\n").trim();
    entries.push({ part: form.part, settings, body });
  }
  return { entries, output };
}

// The frame page: headless, so Hugo reads it but never publishes it. It also
// carries the theme from rubric.md's `::: theme` line, or the one being
// looked at in the editor's list, which the layout uses before hugo.toml's.
export function framePage(entries: FrameEntry[], theme?: ThemeChoice): string {
  return `${JSON.stringify({ title: "The frame, from rubric.md", build: { render: "never", list: "never" }, frame: entries, ...(theme ? { theme } : {}) }, null, 2)}\n`;
}
