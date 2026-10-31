// Sends each line in probe/lines.yaml (or the file given) to Jev once and prints what it became,
// the round trip and the runners-up. Every request and response is kept in
// probe/runs/ so any result can be rerun. Bun loads TYPESAFE_API_KEY from .env.
//
//   bun scripts/probe.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { loadCatalog } from "../src/core/index.ts";
import { ask } from "../src/jev.ts";

const root = join(import.meta.dir, "..");
const catalog = await loadCatalog(join(root, "catalogs/slice/catalog.yaml"));
const linesFile = process.argv[2] ?? "probe/lines.yaml";
const lines = parse(await readFile(join(root, linesFile), "utf8")) as { directive: string; want: string }[];

const runs = [];
let right = 0;
for (const { directive, want } of lines) {
  const asked = await ask(catalog, directive, "post");
  const r = asked.resolution;
  const got =
    r.outcome === "placed" ? r.candidates[0]!.plain
    : r.outcome === "nothing-fits" ? "nothing"
    : r.outcome === "unsettled" ? `unsettled: ${r.candidates.map((c) => c.plain).join(" | ")}`
    : `ERROR ${r.message}`;
  const ok = got === want;
  if (ok) right++;
  const detail =
    r.outcome === "error" ? ""
    : `fits=${r.fits.toFixed(2)} parts=${Object.entries(r.parts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(" ")}` +
      (r.outcome === "placed" && r.candidates[1] ? ` also=${r.candidates[1].plain}` : "") +
      (r.outcome === "placed" && r.candidates[0]!.unsettled.length ? ` unsettled=${r.candidates[0]!.unsettled.join(",")}` : "");
  console.log(`${ok ? "ok  " : "MISS"} ${Math.round(asked.ms).toString().padStart(5)}ms  "${directive}"\n      want ${want}\n      got  ${got}\n      ${detail}`);
  runs.push({ directive, want, got, ok, ...asked });
}

const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
const model = runs.find((r) => r.model)?.model ?? "unknown";
console.log(`\n${right}/${runs.length} as wanted; round trip median ${Math.round(ms[Math.floor(ms.length / 2)]!)}ms, max ${Math.round(ms.at(-1)!)}ms; model ${model}`);

await mkdir(join(root, "probe/runs"), { recursive: true });
const file = join(root, "probe/runs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(file, JSON.stringify({ model, lines: linesFile, catalog: `${catalog.name}@${catalog.version}`, runs }, null, 2) + "\n");
console.log(`kept in ${file}`);
