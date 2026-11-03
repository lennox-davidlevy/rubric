// Replays the writer's real typing from testing/.rubric/keys.jsonl, written by
// the language server while `bun run play` runs, and compares ways of
// choosing the pause before a words line is asked: how many calls to Jev
// each makes, how many of them were half-typed words, and how long a
// finished line waits after its last key.
//
//   bun scripts/pause.ts [keys.jsonl]
//
// It counts only what the pause decides. Leaving the line, Esc and the accept
// key ask at once whatever the pause is, so the waits here are the most a
// line waits.

import { join } from "node:path";

type Edit = { t: number; line: number; words: string; pause: number };

const file = process.argv[2] ?? join(import.meta.dir, "../testing/.rubric/keys.jsonl");
const edits: Edit[] = (await Bun.file(file).text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (edits.length < 2) {
  console.log(`only ${edits.length} edits in ${file}; type some ::: lines with \`bun run play\` running first`);
  process.exit(0);
}

const key = (w: string) => w.trim().toLowerCase();
const burst = (i: number) => i + 1 < edits.length && edits[i + 1]!.line === edits[i]!.line && edits[i + 1]!.t - edits[i]!.t < 2000;

const gaps: number[] = [];
for (let i = 0; i + 1 < edits.length; i++) if (burst(i)) gaps.push(edits[i + 1]!.t - edits[i]!.t);
const sorted = [...gaps].sort((a, b) => a - b);
const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
console.log(`${edits.length} edits to words lines; between keys: median ${q(0.5)} ms, 90% under ${q(0.9)} ms, 99% under ${q(0.99)} ms\n`);

// The workspace's fitted pause, from the gaps seen so far.
function fitted(seen: number[], most = 1000, least = 400): number {
  if (seen.length < 20) return most;
  const s = seen.slice(-200).sort((a, b) => a - b);
  return Math.round(Math.min(most, Math.max(least, 1.5 * s[Math.floor(0.9 * (s.length - 1))]!)));
}

function run(name: string, wait: (seen: number[]) => number): void {
  const asked = new Set<string>();
  const seen: number[] = [];
  let calls = 0, half = 0;
  const waits: number[] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]!;
    const next = edits[i + 1];
    const gap = next ? next.t - e.t : Infinity;
    const d = wait(seen);
    if (next && next.line === e.line && gap < 2000) seen.push(gap);
    // Typing on the same line before the pause ends: nothing is sent.
    if (next && next.line === e.line && gap < d) continue;
    // The words are finished if nothing more is typed on this line soon.
    const finished = !next || next.line !== e.line || gap > 5000;
    if (finished) waits.push(Math.min(d, gap));
    if (asked.has(key(e.words))) continue;
    asked.add(key(e.words));
    calls++;
    if (!finished) half++;
  }
  waits.sort((a, b) => a - b);
  const median = waits[waits.length >> 1] ?? 0;
  console.log(`${name.padEnd(22)} ${String(calls).padStart(4)} calls, ${String(half).padStart(3)} half-typed; a finished line waits ${median} ms`);
}

run("1000 ms (before)", () => 1000);
for (const ms of [700, 500, 400, 300]) run(`${ms} ms`, () => ms);
run("fitted (now)", (seen) => fitted(seen));
