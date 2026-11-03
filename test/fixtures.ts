// Each folder in fixtures/ is a page and what it should become: source.md,
// an optional resolved.json standing in for the cache, and the expected
// content, diagnostics and sidecar entries.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog, parsePlain, preprocess, type PlainForm } from "../src/core/index.ts";

const fixtures = join(import.meta.dir, "fixtures");
const catalog = await loadCatalog(join(import.meta.dir, "../catalogs/slice/catalog.yaml"));

export function fixtureNames(): string[] {
  return readdirSync(fixtures).sort();
}

export function runFixture(name: string) {
  const dir = join(fixtures, name);
  const source = readFileSync(join(dir, "source.md"), "utf8");
  const resolvedPath = join(dir, "resolved.json");
  const resolved: Record<string, string> = existsSync(resolvedPath) ? JSON.parse(readFileSync(resolvedPath, "utf8")) : {};
  const resolve = (words: string): PlainForm | undefined => {
    const plain = resolved[words];
    return plain === undefined ? undefined : parsePlain(plain);
  };
  return { dir, source, ...preprocess(source, catalog, resolve) };
}
