// `rubric watch [site]`: every call the site's process makes to Jev, as it
// happens, one row a call, in columns fitted to the terminal: when, what was
// asked, what it became, how sure Jev was and how long it took. Under a line,
// the parts Jev also considered. On Ctrl-C, a sum.
//
// The process appends each call to .rubric/jev.jsonl while that file exists;
// this empties it and reads it as it grows. The whole request and response
// are in that file for anything the table leaves out.
//
// It also creates .rubric/keys.jsonl, where the process notes when each words
// line was typed; `bun scripts/pause.ts` replays it.

import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, watch as watchFile, writeFileSync } from "node:fs";
import { join } from "node:path";
import { THRESHOLDS } from "./core/questions.ts";

type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> }
  | { type: "score"; legend: Record<string, string>; probabilities: Record<string, number> };

type Answers = Record<string, Answer>;

interface LineCall {
  t: number;
  ms: number;
  pass?: undefined;
  model?: string;
  request: { model: string; state: { directive: string; page: string }; questions: Record<string, unknown> };
  response?: { answers?: Answers } | string;
  resolution:
    | { outcome: "error"; message: string }
    | { outcome: string; fits: number; parts: Record<string, number>; candidates: { part: string; probability: number; plain: string; unsettled: string[] }[] };
}

interface SecondCall {
  t: number;
  ms: number;
  pass: "second";
  part: string;
  model?: string;
  request: { model: string; state: { directive: string } };
  refined?: { settings: Record<string, string>; unsettled: string[]; beyond: number };
  error?: string;
}

interface ThemeCall {
  t: number;
  ms: number;
  pass: "theme";
  request: { state: { directive: string } };
  order: Record<string, number>;
  error?: string;
}

// Beside each draft of a new part: what kind of part the words ask for.
interface TraitsCall {
  t: number;
  ms: number;
  pass: "traits";
  request: { state: { request: string } };
  traits: Record<string, number>;
}

// A kind this table does not know yet: a row with its time, never a crash.
interface OtherCall { t: number; ms: number; pass: string }

export type Call = LineCall | SecondCall | ThemeCall | TraitsCall;

// One cell: its text, and how it is painted on a terminal.
type Paint = (s: string) => string;
interface Cell { text: string; paint?: Paint }

export interface Style { bold: Paint; dim: Paint; green: Paint; yellow: Paint; red: Paint; cyan: Paint }
const plain: Paint = (s) => s;
export const NO_COLOR: Style = { bold: plain, dim: plain, green: plain, yellow: plain, red: plain, cyan: plain };
const ansi = (code: string): Paint => (s) => `\x1b[${code}m${s}\x1b[0m`;
const COLOR: Style = { bold: ansi("1"), dim: ansi("2"), green: ansi("32"), yellow: ansi("33"), red: ansi("31"), cyan: ansi("36") };

const p = (n: number) => n.toFixed(2).replace(/^0/, "");

// The columns, in order: the fixed ones at their width, the two wide ones
// sharing what is left. A narrow terminal loses the time first.
type Key = "n" | "time" | "kind" | "words" | "result" | "answer" | "fits" | "ms";
const FIXED: Partial<Record<Key, number>> = { n: 3, time: 8, kind: 5, result: 12, fits: 4, ms: 5 };
const ORDER: Key[] = ["n", "time", "kind", "words", "result", "answer", "fits", "ms"];
const RIGHT = new Set<Key>(["fits", "ms"]);
const GAP = 2;
const MIN_FLEX = 8;

interface Layout { keys: Key[]; sizes: Record<Key, number> }

function layout(columns: number): Layout {
  const keys = columns < 90 ? ORDER.filter((k) => k !== "time") : ORDER;
  const fixed = keys.reduce((a, k) => a + (FIXED[k] ?? 0), 0) + GAP * (keys.length - 1);
  const left = Math.max(MIN_FLEX * 2, columns - fixed);
  const words = Math.floor(left / 2);
  const sizes = { ...FIXED, words, answer: left - words } as Record<Key, number>;
  return { keys, sizes };
}

function fit(text: string, width: number, right = false): string {
  const t = text.replace(/\s+/g, " ");
  if (t.length > width) return `${t.slice(0, Math.max(0, width - 1))}…`;
  return right ? t.padStart(width) : t.padEnd(width);
}

// A row of cells, each fitted to its column.
function row(cells: Partial<Record<Key, Cell>>, l: Layout): string {
  return l.keys
    .map((k) => {
      const c = cells[k] ?? { text: "" };
      return (c.paint ?? plain)(fit(c.text, l.sizes[k], RIGHT.has(k)));
    })
    .join(" ".repeat(GAP))
    .trimEnd();
}

export function header(columns: number, s: Style = NO_COLOR): string[] {
  const l = layout(columns);
  const names: Record<Key, string> = { n: "#", time: "time", kind: "kind", words: "words", result: "result", answer: "part and settings", fits: "fits", ms: "ms" };
  const cells = Object.fromEntries(ORDER.map((k) => [k, { text: names[k], paint: s.bold }]));
  const width = l.keys.reduce((a, k) => a + l.sizes[k], 0) + GAP * (l.keys.length - 1);
  return [row(cells, l), s.dim("─".repeat(Math.min(width, columns)))];
}

// The rows for one call: its own, and under a line the parts Jev also weighed.
export function rows(c: Call, n: number, columns: number, s: Style = NO_COLOR): string[] {
  const l = layout(columns);
  const time = new Date(c.t).toLocaleTimeString("en-GB");
  const head = { n: { text: String(n), paint: s.dim }, time: { text: time, paint: s.dim }, ms: { text: Number.isFinite(c.ms) ? String(Math.round(c.ms)) : "", paint: s.dim } };
  const out: string[] = [];

  if (c.pass === "traits") {
    const said = Object.entries(c.traits ?? {}).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    out.push(row({
      ...head,
      kind: { text: "new", paint: s.cyan },
      words: { text: c.request?.state?.request ?? "" },
      result: { text: "traits", paint: s.green },
      answer: { text: said.join(", ") || "none", paint: said.length ? plain : s.dim },
    }, l));
    return out;
  }

  if (c.pass !== undefined && c.pass !== "theme" && c.pass !== "second") {
    out.push(row({ ...head, kind: { text: String((c as OtherCall).pass), paint: s.cyan } }, l));
    return out;
  }

  if (c.pass === "theme") {
    const order = Object.entries(c.order ?? {}).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    out.push(row({
      ...head,
      kind: { text: "theme", paint: s.cyan },
      words: { text: c.request.state.directive },
      result: c.error ? { text: "error", paint: s.red } : { text: "ordered", paint: s.green },
      answer: { text: c.error ?? order.join(", ") },
    }, l));
    return out;
  }

  if (c.pass === "second") {
    const said = c.refined ? Object.entries(c.refined.settings).map(([k, v]) => `${k}=${v}`).join(" ") : "";
    const result: Cell = c.error ? { text: "error", paint: s.red }
      : said ? { text: "set", paint: s.green }
      : { text: "no setting", paint: s.yellow };
    out.push(row({
      ...head,
      kind: { text: "after", paint: s.cyan },
      words: { text: `${c.part}: ${c.request.state.directive}` },
      result,
      answer: { text: c.error ?? said },
    }, l));
    const notes = [
      c.refined?.unsettled.length ? `unsettled: ${c.refined.unsettled.join(", ")}` : "",
      c.refined && c.refined.beyond > THRESHOLDS.yes ? `asks for more than ${c.part}'s settings` : "",
    ].filter(Boolean);
    if (notes.length) out.push(under(l, notes.join(" · "), s));
    return out;
  }

  const r = c.resolution;
  const words = c.request.state.directive;
  if (r.outcome === "error" || !("candidates" in r)) {
    out.push(row({
      ...head,
      kind: { text: "line", paint: s.cyan },
      words: { text: words },
      result: { text: "error", paint: s.red },
      answer: { text: "message" in r ? r.message : "" },
    }, l));
    return out;
  }
  const [first] = r.candidates;
  const paint = r.outcome === "placed" ? s.green : s.yellow;
  out.push(row({
    ...head,
    kind: { text: "line", paint: s.cyan },
    words: { text: words },
    result: { text: r.outcome, paint },
    answer: first ? { text: first.plain, paint: s.bold } : { text: "stays as words", paint: s.dim },
    fits: { text: p(r.fits) },
  }, l));

  // The parts Jev also weighed, highest first, and what is left unsettled.
  const others = Object.entries(r.parts)
    .filter(([name, chance]) => name !== first?.part && chance >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, chance]) => `${name} ${p(chance)}`);
  const notes = [
    first ? `${first.part} ${p(first.probability)}` : "",
    ...others,
  ].filter(Boolean).join(" · ");
  const unsettled = first?.unsettled.length ? `  unsettled: ${first.unsettled.join(", ")}` : "";
  if (others.length || unsettled) out.push(under(l, notes + unsettled, s));
  return out;
}

// A dim line under a row, starting at the words column.
function under(l: Layout, text: string, s: Style): string {
  const at = l.keys.indexOf("words");
  const indent = l.keys.slice(0, at).reduce((a, k) => a + l.sizes[k] + GAP, 0);
  const room = l.keys.slice(at).reduce((a, k) => a + l.sizes[k], 0) + GAP * (l.keys.length - at - 1);
  return " ".repeat(indent) + s.dim(fit(text, room).trimEnd());
}

export function watch(root: string): void {
  const log = join(root, ".rubric/jev.jsonl");
  mkdirSync(join(root, ".rubric"), { recursive: true });
  writeFileSync(log, "");
  // When each words line was typed, kept across sessions, so the pause
  // before a line is asked can be fitted to real typing (scripts/pause.ts).
  const keys = join(root, ".rubric/keys.jsonl");
  if (!existsSync(keys)) writeFileSync(keys, "");

  // Color only on a terminal, and as wide as it is.
  const tty = process.stdout.isTTY;
  const s = tty ? COLOR : NO_COLOR;
  const columns = () => Math.max(60, process.stdout.columns ?? 120);

  const session = { calls: 0, errors: 0, ms: 0, started: Date.now() };
  function summary(): string {
    const { calls, errors, ms, started } = session;
    const secs = Math.round((Date.now() - started) / 1000);
    const took = secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`;
    // Failed calls are left out of the average: a timeout is not Jev's speed.
    const ok = calls - errors;
    const avg = ok ? `, ${Math.round(ms / ok)} ms on average` : "";
    return `${s.bold(`${calls} call${calls === 1 ? "" : "s"} to Jev`)}${errors ? `, ${s.red(`${errors} failed`)}` : ""}${avg}, over ${took}.`;
  }

  function print(c: Call): void {
    session.calls++;
    const failed = c.pass === undefined ? c.resolution?.outcome === "error" : "error" in c && Boolean(c.error);
    if (failed) session.errors++;
    else session.ms += c.ms;
    console.log(rows(c, session.calls, columns(), s).join("\n"));
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
      try { print(JSON.parse(l)); } catch (err) { console.log(s.red(`could not read a jev.jsonl line: ${(err as Error).message}`)); }
    }
  }
  watchFile(log, drain);
  // A watch can miss an event; a slow poll catches it.
  setInterval(drain, 1000);
  console.log(s.dim(`calls to Jev from ${root}; Ctrl-C to stop`));
  console.log(header(columns(), s).join("\n"));
  process.on("SIGINT", () => {
    drain();
    console.log(`\n${summary()}`);
    process.exit(0);
  });
}
