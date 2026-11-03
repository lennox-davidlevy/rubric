// Run with UPDATE=1 to rewrite the expected files, then read the diff before
// keeping it.

import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic, Entry } from "../src/core/index.ts";
import { fixtureNames, runFixture } from "./fixtures.ts";

const update = process.env.UPDATE === "1";

// 1-based line and columns, inclusive, the way an editor shows them.
function showDiagnostic(d: Diagnostic): string {
  return `${d.line + 1}:${d.start + 1}-${d.end} ${d.code}: ${d.message}`;
}

function showEntry(e: Entry): string {
  const lines = e.close === undefined ? `${e.line + 1}` : `${e.line + 1}-${e.close + 1}`;
  const outcome = e.placed ? "placed" : `left (${e.reason})`;
  return [lines, e.kind, outcome, e.plain ?? "-", e.words === undefined ? "" : `"${e.words}"`].join(" | ").trimEnd();
}

function check(path: string, actual: string): void {
  if (update || !existsSync(path)) writeFileSync(path, actual);
  else expect(actual).toBe(readFileSync(path, "utf8"));
}

for (const name of fixtureNames()) {
  test(name, () => {
    const { dir, source, content, entries, diagnostics } = runFixture(name);
    expect(content.split("\n").length).toBe(source.split("\n").length);
    check(join(dir, "expected.md"), content);
    check(join(dir, "diagnostics.txt"), diagnostics.map(showDiagnostic).join("\n") + "\n");
    check(join(dir, "entries.txt"), entries.map(showEntry).join("\n") + "\n");
  });
}
