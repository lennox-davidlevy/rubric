// The live playground: builds testing/ once, serves it with Hugo on 1415, and
// prints every call the language server makes to Jev, with what was sent and
// what came back.
//
//   bun run play
//
// The language server runs inside Neovim, so it cannot print here. It appends
// each call to testing/.rubric/jev.jsonl when that file exists; this script
// empties it at start and prints each line as it lands. The whole request and
// response are in that file for anything the print leaves out.

import { closeSync, mkdirSync, openSync, readSync, statSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { THRESHOLDS } from "../src/core/questions.ts";

const repo = join(import.meta.dir, "..");
const site = join(repo, "testing");
const log = join(site, ".rubric/jev.jsonl");
const port = process.env.RUBRIC_PORT ?? "1415";

const built = Bun.spawnSync(["bun", "src/cli.ts", "build", "testing"], { cwd: repo, stdout: "inherit", stderr: "inherit" });
if (built.exitCode !== 0) process.exit(built.exitCode ?? 1);

mkdirSync(join(site, ".rubric"), { recursive: true });
writeFileSync(log, "");

const hugo = Bun.spawn(["hugo", "server", "-s", "testing", "--port", port], { cwd: repo, stdout: "inherit", stderr: "inherit" });

// Colour only on a terminal.
const tty = process.stdout.isTTY;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1"), dim = paint("2"), green = paint("32"), yellow = paint("33"), red = paint("31"), cyan = paint("36");

type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> }
  | { type: "score"; legend: Record<string, string>; probabilities: Record<string, number> };

interface Call {
  t: number;
  ms: number;
  model?: string;
  request: { model: string; state: { directive: string; page: string }; questions: Record<string, unknown> };
  response?: { answers?: Record<string, Answer> } | string;
  resolution:
    | { outcome: "error"; message: string }
    | { outcome: string; fits: number; parts: Record<string, number>; candidates: { part: string; probability: number; plain: string; unsettled: string[] }[] };
}

const p = (n: number) => n.toFixed(2).replace(/^0/, "");
// A probability, brighter the surer it is.
const prob = (n: number) => (n >= 0.7 ? bold(p(n)) : n >= 0.3 ? p(n) : dim(p(n)));

function print(c: Call): void {
  const time = new Date(c.t).toLocaleTimeString("en-GB");
  const { directive, page } = c.request.state;
  const ids = Object.keys(c.request.questions);
  const count = (prefix: string) => ids.filter((id) => id.startsWith(prefix)).length;
  const out: string[] = [];
  out.push("", cyan(`── Jev ${time} ${"─".repeat(48)}`));
  out.push(`${bold("sent")}      ${JSON.stringify(directive)}  ${dim(`page=${page}  model=${c.request.model}`)}`);
  out.push(dim(`          ${ids.length} questions: part, ${count("fits:")} fits, ${count("setting:")} setting, ${count("said:")} said`));

  const answers = typeof c.response === "object" ? c.response.answers : undefined;
  if (answers) {
    out.push(`${bold("received")}  ${dim(`${Math.round(c.ms)} ms  model=${c.model ?? "?"}`)}`);
    const pick = answers.part?.type === "choice" ? answers.part : undefined;
    // Parts by Jev's probability, highest first; each with its fit and settings.
    const parts = Object.entries(pick?.probabilities ?? {}).sort((a, b) => b[1] - a[1]);
    const width = Math.max(...parts.map(([n]) => n.length));
    for (const [name, chance] of parts) {
      const fits = answers[`fits:${name}`];
      const settings: string[] = [];
      for (const id of ids) {
        const m = /^setting:([^:]+):(.+)$/.exec(id);
        if (!m || m[1] !== name) continue;
        const a = answers[id], said = answers[`said:${name}:${m[2]}`];
        const saidText = said?.type === "noul" ? dim(` said ${p(said.noul)}`) : "";
        if (a?.type === "choice") settings.push(`${m[2]}=${a.choice} ${prob(a.probabilities[a.choice] ?? 0)}${saidText}`);
        else if (a?.type === "score") {
          const [level, lp] = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0]!;
          settings.push(`${m[2]}=${JSON.stringify(a.legend[level] ?? level)} ${prob(lp)}${saidText}`);
        } else if (a?.type === "noul") settings.push(`${m[2]} ${prob(a.noul)}`);
      }
      const head = `          ${name.padEnd(width)}  part ${prob(chance)}  fits ${fits?.type === "noul" ? prob(fits.noul) : "?"}`;
      out.push(head + (settings.length ? dim("  │ ") + settings.join(dim("  ·  ")) : ""));
    }
  } else if (c.response !== undefined) {
    out.push(`${bold("received")}  ${dim(`${Math.round(c.ms)} ms`)}`, `          ${JSON.stringify(c.response, null, 2).replace(/\n/g, "\n          ")}`);
  }

  const r = c.resolution;
  if (r.outcome === "error") out.push(`${bold("result")}    ${red("error")} ${"message" in r ? r.message : ""}`);
  else if ("candidates" in r) {
    const colour = r.outcome === "placed" ? green : yellow;
    const [first, second] = r.candidates;
    const line = first ? `::: ${first.plain}` : "nothing fits, the line stays plain";
    const unsettled = first?.unsettled.length ? dim(`  unsettled: ${first.unsettled.join(", ")}`) : "";
    out.push(`${bold("result")}    ${colour(r.outcome)}  ${bold(line)}${unsettled}  ${dim(`fits ${p(r.fits)}`)}`);
    // The resolver offers the top two for an unsettled line; a second Jev
    // gave almost nothing is not worth a line.
    if (second && second.probability >= THRESHOLDS.close) out.push(dim(`          runner-up ::: ${second.plain} (${p(second.probability)})`));
  }
  console.log(out.join("\n"));
}

// Reads whatever has been appended since the last read, a whole line at a time.
let offset = 0, partial = "";
function drain(): void {
  let size: number;
  try { size = statSync(log).size; } catch { return; }
  if (size < offset) offset = 0;
  if (size === offset) return;
  const fd = openSync(log, "r");
  const buf = Buffer.alloc(size - offset);
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  offset = size;
  const lines = (partial + buf.toString("utf8")).split("\n");
  partial = lines.pop()!;
  for (const l of lines) {
    if (!l.trim()) continue;
    try { print(JSON.parse(l)); } catch (err) { console.log(red(`rubric: could not read a jev.jsonl line: ${(err as Error).message}`)); }
  }
}
watch(log, drain);
// A watch can miss an event; a slow poll catches it.
setInterval(drain, 1000);

process.on("SIGINT", () => { hugo.kill(); process.exit(0); });
process.exit(await hugo.exited);
