// What the editor's theme list shows: every combination in themes.yaml with
// its colors, its type and its picture, and every piece that can be swapped
// in. Sent as data, so each editor draws its own list from the same thing.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ThemeChoice } from "../core/index.ts";
import type { Site } from "../site.ts";
import { load, type Palette, type Pairing, type Scale } from "../theme.ts";

// The colors worth seeing in a list, in the order they are shown.
const SWATCHES = ["paper", "ink", "accent", "muted", "rule", "tint", "band", "band-ink"] as const;

export interface Look {
  // light or dark
  scheme: string;
  colors: Record<string, string>;
  // How the type is set, and how wide and large it is, in words.
  type: string;
  size: string;
}

export interface ThemeItem extends Look {
  name: string;
  description: string;
  skin?: string;
  palette: string;
  pairing: string;
  scale: string;
  // The first screen of a sample post in the theme, when there is one.
  picture?: string;
}

export interface PieceItem {
  name: string;
  description: string;
  // A palette's colors.
  scheme?: string;
  colors?: Record<string, string>;
}

export interface ThemeList {
  themes: ThemeItem[];
  palette: PieceItem[];
  pairing: PieceItem[];
  scale: PieceItem[];
  // What the line says now.
  current?: ThemeChoice;
  // The words the list was put in order by, or why it could not be.
  ranked?: string;
  error?: string;
}

// How likely each theme is, by name, for the words on the line: Jev, or the
// stub in tests.
export type ThemeRanker = (words: string, themes: ThemeItem[]) => Promise<Record<string, number>>;

const swatches = (p: Palette) => Object.fromEntries(SWATCHES.map((k) => [k, p.colors[k]!]));

export function themeList(site: Site): ThemeList {
  const cat = load(site.themeDir);
  const themes: ThemeItem[] = [];
  for (const t of Object.values(cat.themes)) {
    const palette = cat.palettes[t.palette], pairing = cat.pairings[t.pairing], scale = cat.scales[t.scale];
    if (!palette || !pairing || !scale) continue;
    const picture = join(site.themeDir, "previews", `${t.name}.png`);
    themes.push({
      name: t.name, description: t.description, ...(t.skin ? { skin: t.skin } : {}),
      palette: t.palette, pairing: t.pairing, scale: t.scale,
      scheme: palette.scheme, colors: swatches(palette), type: pairing.description, size: scale.description,
      ...(existsSync(picture) ? { picture } : {}),
    });
  }
  const piece = (p: Palette | Pairing | Scale): PieceItem => ({
    name: p.name, description: p.description,
    ...("colors" in p ? { scheme: p.scheme, colors: swatches(p) } : {}),
  });
  return {
    themes,
    palette: Object.values(cat.palettes).map(piece),
    pairing: Object.values(cat.pairings).map(piece),
    scale: Object.values(cat.scales).map(piece),
  };
}
