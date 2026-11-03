// Sends each line of a lines file to Jev and prints what it became, the round
// trip and the runners-up. Every request and response is kept in probe/runs/
// so any result can be rerun. Bun loads TYPESAFE_API_KEY from .env. It costs
// money: ask before running it.
//
//   bun scripts/probe.ts [lines.yaml] [--catalog <name>] [--steps 1|2|both]
//
// The catalog defaults to slice and the lines to probe/lines.yaml. A line may
// say `place: site` (a line in rubric.md); it is asked only about the parts
// for its place. `--steps both` asks every line both ways and compares them.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { atPlace, loadCatalog, type Catalog, type Place } from "../src/core/index.ts";
import { ask, type Asked } from "../src/jev.ts";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] ?? fallback : fallback;
};
const catalogName = option("catalog", "slice");
const stepsOption = option("steps", "1");
const linesFile = args[0] ?? "probe/lines.yaml";
const modes = (stepsOption === "both" ? [1, 2] : [Number(stepsOption)]) as (1 | 2)[];

const catalog = await loadCatalog(join(root, "catalogs", catalogName, "catalog.yaml"));
const lines = parse(await readFile(join(root, linesFile), "utf8")) as { directive: string; want: string; place?: Place }[];
// A comma in an unquoted YAML flow mapping ends the value, and the rest of
// the line becomes a stray key: the directive is sent cut short. Refuse it.
for (const l of lines) {
  const stray = Object.keys(l).filter((k) => !["directive", "want", "place"].includes(k));
  if (stray.length) throw new Error(`${linesFile}: "${l.directive}" has stray keys (${stray.join(", ")}); quote a directive with a comma in it`);
}
const byPlace: Record<Place, Catalog> = { writing: atPlace(catalog, "writing"), site: atPlace(catalog, "site") };
// A catalog with no `place` fields is all writing, so a line asks the whole of it.
const forLine = (place: Place | undefined) => byPlace[place ?? "writing"];

const got = (a: Asked) => {
  const r = a.resolution;
  return r.outcome === "placed" ? r.candidates[0]!.plain
    : r.outcome === "nothing-fits" ? "nothing"
    : r.outcome === "unsettled" ? `unsettled: ${r.candidates.map((c) => c.plain).join(" | ")}`
    : `ERROR ${r.message}`;
};
const questions = (a: Asked) => Object.keys(a.request.questions).length + Object.keys(a.then?.request.questions ?? {}).length;

type Run = { directive: string; want: string; place: Place; steps: 1 | 2; got: string; ok: boolean; questions: number } & Asked;
const runs: Run[] = [];
for (const { directive, want, place = "writing" } of lines) {
  for (const steps of modes) {
    const asked = await ask(forLine(place), directive, place === "site" ? "home" : "post", undefined, steps);
    const r = asked.resolution;
    const g = got(asked);
    const ok = g === want;
    const detail = r.outcome === "error" ? "" :
      `fits=${r.fits.toFixed(2)} parts=${Object.entries(r.parts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(" ")}` +
      (r.outcome === "placed" && r.candidates[1] ? ` also=${r.candidates[1].plain}` : "") +
      (r.outcome === "placed" && r.candidates[0]!.unsettled.length ? ` unsettled=${r.candidates[0]!.unsettled.join(",")}` : "");
    const tag = modes.length > 1 ? ` [${steps} step${steps === 2 ? "s" : ""}]` : "";
    console.log(`${ok ? "ok  " : "MISS"} ${Math.round(asked.ms).toString().padStart(5)}ms ${String(questions(asked)).padStart(3)}q${tag}  "${directive}"${place === "site" ? " (site)" : ""}\n      want ${want}\n      got  ${g}\n      ${detail}`);
    runs.push({ directive, want, place, steps, got: g, ok, questions: questions(asked), ...asked });
  }
}

const model = runs.find((r) => r.model)?.model ?? "unknown";
const pct = (xs: number[], p: number) => Math.round(xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0);
console.log("");
for (const steps of modes) {
  const rs = runs.filter((r) => r.steps === steps);
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  const right = (f: (r: Run) => boolean) => `${rs.filter((r) => f(r) && r.ok).length}/${rs.filter(f).length}`;
  const q = Math.round(rs.reduce((n, r) => n + r.questions, 0) / Math.max(1, rs.length));
  console.log(`${steps} step${steps === 2 ? "s" : " "}: ${right(() => true)} as wanted (writing ${right((r) => r.place === "writing")}, site ${right((r) => r.place === "site")}, nothing ${right((r) => r.want === "nothing")}); ` +
    `round trip median ${pct(ms, 0.5)}ms, p90 ${pct(ms, 0.9)}ms, max ${pct(ms, 1)}ms; ${q} questions a line; ${rs.filter((r) => r.resolution.outcome === "error").length} errors`);
}
if (modes.length > 1) {
  const differ = lines.filter((l) => runs.filter((r) => r.directive === l.directive).map((r) => r.got).some((g, _, all) => g !== all[0]));
  console.log(`${differ.length} lines came out differently in the two modes`);
}
console.log(`model ${model}, catalog ${catalog.name}@${catalog.version}`);

await mkdir(join(root, "probe/runs"), { recursive: true });
const file = join(root, "probe/runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${catalog.name}-steps-${stepsOption}.json`);
await writeFile(file, JSON.stringify({ model, lines: linesFile, catalog: `${catalog.name}@${catalog.version}`, steps: stepsOption, runs }, null, 2) + "\n");
console.log(`kept in ${file}`);
