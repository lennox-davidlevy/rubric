// What each words line resolved to, so a line is asked once. The key is the
// catalog's name and version, the page kind and the exact directive text:
// change a description, bump the version, and every live line is asked again.
// Errors are never cached.

import { readFile } from "node:fs/promises";
import { writeWhole } from "./write.ts";
import type { Catalog } from "./catalog.ts";
import { parsePlain, type PlainForm } from "./plain.ts";
import type { PageKind } from "./questions.ts";
import type { Refined, Resolution } from "./resolve.ts";

export type Cached = Exclude<Resolution, { outcome: "error" }> & { model: string; at: string };
export type CachedRefine = Refined & { model: string; at: string };

// Words after a ":" as the cache keys them: the same request however it is
// cased, spaced or ended, so "A bit bigger." is asked once with "a bit bigger".
export function refineWords(words: string): string {
  return words.toLowerCase().replace(/\s+/g, " ").replace(/[\s.,;:!?]+$/, "").trim();
}

export class Cache {
  // Words lines and refinements share one file; their keys never collide.
  #entries: Record<string, Cached | CachedRefine>;

  constructor(entries: Record<string, Cached | CachedRefine> = {}) {
    this.#entries = entries;
  }

  static key(catalog: Catalog, page: PageKind, directive: string): string {
    return JSON.stringify([catalog.name, catalog.version, page, directive]);
  }

  static async load(path: string): Promise<Cache> {
    try {
      return new Cache(JSON.parse(await readFile(path, "utf8")));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Cache();
      throw err;
    }
  }

  async save(path: string): Promise<void> {
    await writeWhole(path, JSON.stringify(this.#entries, null, 2) + "\n");
  }

  get(catalog: Catalog, page: PageKind, directive: string): Cached | undefined {
    return this.#entries[Cache.key(catalog, page, directive)] as Cached | undefined;
  }

  // A refinement depends on the part and the words, not the page.
  static refineKey(catalog: Catalog, part: string, words: string): string {
    return JSON.stringify(["refine", catalog.name, catalog.version, part, refineWords(words)]);
  }

  getRefine(catalog: Catalog, part: string, words: string): CachedRefine | undefined {
    return this.#entries[Cache.refineKey(catalog, part, words)] as CachedRefine | undefined;
  }

  setRefine(catalog: Catalog, part: string, words: string, refined: Refined, model: string): void {
    this.#entries[Cache.refineKey(catalog, part, words)] = { ...refined, model, at: new Date().toISOString() };
  }

  set(catalog: Catalog, page: PageKind, directive: string, resolution: Resolution, model: string): void {
    if (resolution.outcome === "error") return;
    this.#entries[Cache.key(catalog, page, directive)] = { ...resolution, model, at: new Date().toISOString() };
  }

  // The preprocessor's lookup: the plain form a words line was placed as.
  resolver(catalog: Catalog, page: PageKind): (words: string) => PlainForm | undefined {
    return (words) => {
      const hit = this.get(catalog, page, words);
      return hit?.outcome === "placed" && hit.candidates[0] ? parsePlain(hit.candidates[0].plain) : undefined;
    };
  }
}
