// The site's theme, chosen in rubric.md with one line: `::: theme paper`, and
// a piece swapped with `palette=`, `pairing=` or `scale=`. It is chosen from a
// list in the editor, by looking; words after `theme` (`::: theme warm and
// bookish`) only put that list in order. The line has no body and no closing
// `:::`.

import type { Diagnostic } from "./diagnostic.ts";
import type { ThemeNames } from "./catalog.ts";

export const THEME = "theme";
export const PIECES = ["palette", "pairing", "scale"] as const;
export type Piece = (typeof PIECES)[number];

export interface ThemeChoice {
  // The combination, from themes.yaml. Left out, the site's own (hugo.toml).
  name?: string;
  palette?: string;
  pairing?: string;
  scale?: string;
}

export interface ThemeLine {
  choice: ThemeChoice;
  // Words in place of a name, to order the list by.
  words?: string;
}

// Whether a line's text (after the colons) is a theme line: it starts with
// the word `theme`, alone or followed by a space.
export function isThemeLine(text: string, themes: ThemeNames | undefined): boolean {
  return themes !== undefined && /^theme(\s|$)/.test(text);
}

// `text` starts at column `col` of line `line`.
export function parseThemeLine(text: string, col: number, line: number, themes: ThemeNames): { theme: ThemeLine; problems: Diagnostic[] } {
  const choice: ThemeChoice = {};
  const problems: Diagnostic[] = [];
  const words: string[] = [];
  for (const m of text.slice(THEME.length).matchAll(/\S+/g)) {
    const token = m[0];
    const start = col + THEME.length + m.index;
    const at = { line, start, end: start + token.length };
    const eq = token.indexOf("=");
    // A piece's name without its "=" yet, after a theme's name, is that
    // setting being typed; among words (`large scale editorial`) it's a word.
    const typing = eq < 0 && (PIECES as readonly string[]).includes(token) && words.length === 1 && themes.themes.includes(words[0]!);
    if (eq < 0 && !typing) {
      words.push(token);
      continue;
    }
    const key = eq < 0 ? token : token.slice(0, eq), value = eq < 0 ? "" : token.slice(eq + 1);
    if (!(PIECES as readonly string[]).includes(key)) {
      problems.push({ ...at, code: "unknown-setting", message: `a theme swaps only its ${PIECES.join(", ")}` });
    } else if (choice[key as Piece] !== undefined) {
      problems.push({ ...at, code: "duplicate-setting", message: `${key} is given twice` });
    } else if (!themes[key as Piece].includes(value)) {
      problems.push({ ...at, code: "value-not-allowed", message: value === "" ? `which ${key}? the list opens on this line` : `there is no ${key} called ${value}` });
    } else {
      choice[key as Piece] = value;
    }
  }
  const said = words.join(" ");
  if (words.length === 1 && themes.themes.includes(said)) return { theme: { choice: { name: said, ...choice } }, problems };
  return { theme: { choice, ...(said ? { words: said } : {}) }, problems };
}

export function formatThemeLine(choice: ThemeChoice): string {
  return [THEME, choice.name, ...PIECES.filter((p) => choice[p]).map((p) => `${p}=${choice[p]}`)].filter(Boolean).join(" ");
}
