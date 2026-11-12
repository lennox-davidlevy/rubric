// The live playground: builds testing/ once, serves it with Hugo on 1415, and
// prints every call the language server makes to Jev, with what was sent and
// what came back.
//
//   bun run play [site]
//
// Another site than testing/ is named by its folder: `bun run play sites/demo`.
//
// The language server runs inside Neovim, so it cannot print here. It appends
// each call to testing/.rubric/jev.jsonl when that file exists; this script
// empties it at start and prints each line as it lands. The whole request and
// response are in that file for anything the print leaves out.
//
// It also creates testing/.rubric/keys.jsonl, where the server notes when
// each words line was typed; `bun scripts/pause.ts` replays it.

import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, watch, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { THRESHOLDS } from "../src/core/questions.ts";

const repo = join(import.meta.dir, "..");
const named = process.argv[2] ?? "testing";
const site = resolve(repo, named);
if (!existsSync(join(site, "rubric.md"))) {
  console.error(`${named} is not a Rubric site: it has no rubric.md`);
  process.exit(1);
}
const log = join(site, ".rubric/jev.jsonl");
const port = process.env.RUBRIC_PORT ?? "1415";

const built = Bun.spawnSync(["bun", "src/cli.ts", "build", site], { cwd: repo, stdout: "inherit", stderr: "inherit" });
if (built.exitCode !== 0) process.exit(built.exitCode ?? 1);

mkdirSync(join(site, ".rubric"), { recursive: true });
writeFileSync(log, "");
// When each words line was typed, kept across sessions, so the pause before
// a line is asked can be fitted to real typing (scripts/pause.ts).
const keys = join(site, ".rubric/keys.jsonl");
if (!existsSync(keys)) writeFileSync(keys, "");

const hugo = Bun.spawn(["hugo", "server", "-s", site, "--port", port], { cwd: repo, stdout: "inherit", stderr: "inherit" });

// Color only on a terminal.
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

// This run's calls, for the count on each block and the summary at the end.
const session = { calls: 0, errors: 0, ms: 0, started: Date.now() };

function summary(): string {
  const { calls, errors, ms, started } = session;
  const secs = Math.round((Date.now() - started) / 1000);
  const took = secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`;
  // Failed calls are left out of the average: a timeout is not Jev's speed.
  const ok = calls - errors;
  const avg = ok ? `, ${Math.round(ms / ok)} ms on average` : "";
  return `${bold(`${calls} call${calls === 1 ? "" : "s"} to Jev`)} this session${errors ? `, ${red(`${errors} failed`)}` : ""}${avg}, over ${took}.`;
}

// The second pass: words after a pinned part's ":", asked only about it.
interface Second {
  t: number;
  ms: number;
  pass: "second";
  part: string;
  model?: string;
  request: { model: string; state: { directive: string }; questions: Record<string, unknown> };
  response?: { answers?: Record<string, Answer> } | string;
  refined?: { settings: Record<string, string>; unsettled: string[]; beyond: number };
  error?: string;
}

function printSecond(c: Second): void {
  session.calls++;
  if (c.error) session.errors++;
  else session.ms += c.ms;
  const time = new Date(c.t).toLocaleTimeString("en-GB");
  const head = `── Jev #${session.calls} ${time} second pass `;
  const out = ["", cyan(head + "─".repeat(Math.max(4, 64 - head.length)))];
  out.push(`${bold("sent")}      ${JSON.stringify(c.request.state.directive)}  ${dim(`about ${c.part}  ${Object.keys(c.request.questions).length} questions`)}`);
  const answers = typeof c.response === "object" ? c.response.answers : undefined;
  if (answers) {
    out.push(`${bold("received")}  ${dim(`${Math.round(c.ms)} ms  model=${c.model ?? "?"}`)}`);
    for (const id of Object.keys(c.request.questions)) {
      const m = /^setting:[^:]+:(.+)$/.exec(id);
      if (!m) continue;
      const a = answers[id], told = answers[`told:${c.part}:${m[1]}`];
      const toldText = told?.type === "noul" ? `told ${prob(told.noul)}` : "";
      const value =
        a?.type === "choice" ? `${a.choice} ${prob(a.probabilities[a.choice] ?? 0)}`
        : a?.type === "score" ? (() => { const [l, lp] = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0]!; return `${JSON.stringify(a.legend[l] ?? l)} ${prob(lp)}`; })()
        : a?.type === "noul" ? prob(a.noul) : "?";
      out.push(`          ${m[1]}  ${toldText}  ${dim("→")} ${value}`);
    }
    const beyond = answers.beyond;
    if (beyond?.type === "noul") out.push(`          beyond its settings  ${prob(beyond.noul)}`);
  }
  if (c.error) out.push(`${bold("result")}    ${red("error")} ${c.error}`);
  else if (c.refined) {
    const said = Object.entries(c.refined.settings).map(([k, v]) => `${k}=${v}`).join(" ") || "no setting";
    const extra = [
      c.refined.unsettled.length ? `unsettled: ${c.refined.unsettled.join(", ")}` : "",
      c.refined.beyond > THRESHOLDS.yes ? "asks for more than its settings" : "",
    ].filter(Boolean).join("  ");
    out.push(`${bold("result")}    ${green(said)}${extra ? dim(`  ${extra}`) : ""}`);
  }
  console.log(out.join("\n"));
}

function print(c: Call | Second): void {
  if ("pass" in c) return printSecond(c);
  session.calls++;
  if (c.resolution.outcome === "error") session.errors++;
  else session.ms += c.ms;
  const time = new Date(c.t).toLocaleTimeString("en-GB");
  const { directive, page } = c.request.state;
  const ids = Object.keys(c.request.questions);
  const count = (prefix: string) => ids.filter((id) => id.startsWith(prefix)).length;
  const out: string[] = [];
  const head = `── Jev #${session.calls} ${time} `;
  out.push("", cyan(head + "─".repeat(Math.max(4, 64 - head.length))));
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
    const color = r.outcome === "placed" ? green : yellow;
    const [first, second] = r.candidates;
    const line = first ? `::: ${first.plain}` : "nothing fits, the line stays plain";
    const unsettled = first?.unsettled.length ? dim(`  unsettled: ${first.unsettled.join(", ")}`) : "";
    out.push(`${bold("result")}    ${color(r.outcome)}  ${bold(line)}${unsettled}  ${dim(`fits ${p(r.fits)}`)}`);
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

// The relay for the live preview's cursor: the language server posts where
// the writer's cursor is, and each open preview page listens and scrolls to
// it (rubric-live.js). The last position is sent to a page as it connects,
// so a page opened by moving to another file scrolls straight to the cursor.
const relayPort = Number(process.env.RUBRIC_RELAY_PORT ?? "1416");
// The language server and the page both reach it at 127.0.0.1:1416, or at
// relay = "…" under [params.rubric] in hugo.toml.
const listeners = new Set<ReadableStreamDefaultController<string>>();
let lastCursor: string | undefined;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
try {
  Bun.serve({
    port: relayPort,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });
      if (req.method === "POST" && url.pathname === "/cursor") {
        lastCursor = JSON.stringify(await req.json());
        for (const c of listeners) {
          try { c.enqueue(`data: ${lastCursor}\n\n`); } catch { listeners.delete(c); }
        }
        return new Response(null, { status: 204, headers: cors });
      }
      if (url.pathname === "/events") {
        let me: ReadableStreamDefaultController<string>;
        const stream = new ReadableStream<string>({
          start(c) {
            me = c;
            listeners.add(c);
            c.enqueue(": rubric\n\n");
            if (lastCursor) c.enqueue(`data: ${lastCursor}\n\n`);
          },
          cancel() { listeners.delete(me); },
        });
        return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
      }
      return new Response("not found", { status: 404, headers: cors });
    },
  });
} catch (err) {
  console.log(yellow(`rubric: the preview will not follow the cursor: port ${relayPort} is taken (${(err as Error).message})`));
}

// Ctrl-C reaches Hugo too; the summary prints once it has gone.
const finish = (code: number) => {
  drain();
  console.log(`\n${summary()}`);
  process.exit(code);
};
process.on("SIGINT", () => { hugo.kill(); });
finish(await hugo.exited);
