// What each words line resolved to, so a line is asked once. The key is the
// catalog's name and version, the page kind and the exact directive text:
// change a description, bump the version, and every live line is asked again.
// Errors are never cached.

import { readFile } from "node:fs/promises";
import { writeWhole } from "./write.ts";
import type { Catalog } from "./catalog.ts";
import { parsePlain, type PlainForm } from "./plain.ts";
import type { PageKind } from "./questions.ts";
import type { Resolution } from "./resolve.ts";

export type Cached = Exclude<Resolution, { outcome: "error" }> & { model: string; at: string };

export class Cache {
  #entries: Record<string, Cached>;

  constructor(entries: Record<string, Cached> = {}) {
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
    return this.#entries[Cache.key(catalog, page, directive)];
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
