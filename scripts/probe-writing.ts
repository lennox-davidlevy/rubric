// The probe for parts from the writing (docs/plan.md, "Before the app", 4):
// can Jev alone, with no harness, say which blocks of a plain post a part
// belongs on, and say no to ordinary prose? Nothing here is built into
// Rubric; the wording lives in this file until the probe holds, then moves
// to questions.ts and the catalog.
//
//   bun scripts/probe-writing.ts count          cut the posts, count the questions; free
//   bun scripts/probe-writing.ts run            one request per post to Jev; paid, ask first
//   bun scripts/probe-writing.ts score [run]    score a saved run against labels.yaml; free
//   SET=fresh before any of them: the held-out posts in probe/writing/fresh/
//
// Code cuts each post into blocks and narrows each block's candidates by its
// kind. Jev answers one Noul per block and candidate (does the block fit
// writing that…), and one per block on whether it is ordinary prose. Code
// decides: a part is offered on a clear yes when the block is not plain
// prose, at most CAP a post, the surest first. Pictures are code's alone.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { Question } from "../src/core/index.ts";
import { askRaw } from "../src/jev.ts";

const root = join(import.meta.dir, "..");
// SET=fresh runs the held-out posts in probe/writing/fresh/, with their own labels and runs.
const dir = join(root, "probe", "writing", process.env.SET ?? "");

type Kind = "paragraph" | "heading" | "ordered" | "unordered" | "quote" | "table" | "code" | "pictures";
interface Block { id: string; kind: Kind; text: string; first: boolean }

// A plain post as blocks: split at blank lines, a fence kept whole.
export function cut(markdown: string): Block[] {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const raw: string[] = [];
  let cur: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "") {
      if (cur.length) raw.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) raw.push(cur.join("\n"));
  let paragraphs = 0;
  return raw.map((text, i) => {
    const kind: Kind =
      /^#{1,6} /.test(text) ? "heading"
      : /^```/.test(text) ? "code"
      : text.split("\n").every((l) => /^!\[[^\]]*\]\([^)]*\)$/.test(l.trim())) ? "pictures"
      : /^> /.test(text) ? "quote"
      : /^\|/.test(text) ? "table"
      : /^\d+\. /.test(text) ? "ordered"
      : /^[-*] /.test(text) ? "unordered"
      : "paragraph";
    const first = kind === "paragraph" && paragraphs++ === 0;
    return { id: `b${i + 1}`, kind, text, first };
  });
}

// What a part fits, said of the writing: the line each part would carry in
// the catalog. `pull` is a quote set large, of the post's own words.
const FITS: Record<string, { yes: string; no: string }> = {
  lead: { yes: "opens the post by setting up what it is about, and deserves to be set larger as its introduction", no: "starts telling the story or giving information straight away, like any other paragraph" },
  callout: { yes: "is a warning, a tip or a reminder the reader must not miss, which stands apart from the story or explanation around it", no: "carries on the story or explanation, and nothing in it is a warning, a tip or a reminder" },
  sidenote: { yes: "is an aside: an extra fact or comment the reader could skip without losing the thread", no: "is part of the thread of the writing, or something the reader must read" },
  stats: { yes: "gives a few key numbers worth showing at a glance, each a figure with what it counts", no: "mentions a number in passing, or has no figures that matter on their own" },
  fold: { yes: "is a question followed by its answer, as in a list of frequently asked questions", no: "is not a question with its answer" },
  testimonial: { yes: "is praise for a product or a piece of work, in the words of a customer or reader who is named", no: "is not praise from a named customer or reader" },
  pull: { yes: "contains one striking sentence that sums up the whole post and is worth repeating in large type", no: "is an ordinary paragraph with no sentence that sums up the post" },
  quote: { yes: "quotes the words someone said or wrote", no: "is the writer's own words, not a quotation" },
  steps: { yes: "is a sequence of instructions or points meant to be read in order", no: "is a list whose items could be read in any order" },
  timeline: { yes: "lists events, each with its date or day, in the order they happened or will happen", no: "is not a list of dated events" },
  glossary: { yes: "explains what several terms mean, one term at a time", no: "is not a list of terms with their meanings" },
  cards: { yes: "lists several separate things, each with a name and a few words of its own, that would read well side by side", no: "is a plain list of short items, such as ingredients or tasks" },
  chart: { yes: "is a table of numbers whose amounts are worth comparing in a picture", no: "is a table of words, or of numbers that need no comparing" },
};

// Which parts each kind of block is asked about.
const CANDIDATES: Record<Kind, string[]> = {
  paragraph: ["callout", "sidenote", "stats", "fold", "testimonial", "pull"],
  quote: ["quote", "testimonial", "callout"],
  ordered: ["steps", "timeline"],
  unordered: ["glossary", "cards", "timeline"],
  table: ["chart", "stats"],
  heading: [], code: [], pictures: [],
};
const candidates = (b: Block) => (b.first ? ["lead", ...CANDIDATES[b.kind]] : CANDIDATES[b.kind]);

const PROSE = {
  yes: "is ordinary running prose that carries the post's story or explanation along, and reads best left as it is",
  no: "stands apart from the writing around it: a warning, a quotation, a list, a figure, a question and answer, or an aside",
};

function questions(blocks: Block[]): Record<string, Question> {
  const q: Record<string, Question> = {};
  for (const b of blocks) {
    const asked = candidates(b);
    if (!asked.length) continue;
    q[`prose:${b.id}`] = { type: "noul", instructions: `Is \`blocks.${b.id}\` ordinary prose?`, criteria: { true: `The block ${PROSE.yes}.`, false: `The block ${PROSE.no}.` } };
    for (const part of asked) {
      const f = FITS[part]!;
      q[`fits:${b.id}:${part}`] = { type: "noul", instructions: `Is \`blocks.${b.id}\` writing that ${f.yes}?`, criteria: { true: `The block ${f.yes}.`, false: `The block ${f.no}.` } };
    }
  }
  return q;
}

const state = (title: string, blocks: Block[]) => ({
  title,
  blocks: Object.fromEntries(blocks.map((b) => [b.id, b.text])),
});

// The decision, in code, from saved answers, so thresholds are tried free.
interface Offer { block: Block; part: string; p: number }
function decide(blocks: Block[], answers: Record<string, { noul?: number }>, yes: number, prose: number, cap: number): Offer[] {
  const offers: Offer[] = [];
  for (const b of blocks) {
    if (b.kind === "pictures") {
      offers.push({ block: b, part: b.text.split("\n").length > 1 ? "gallery" : "figure", p: 1 });
      continue;
    }
    const asked = candidates(b);
    if (!asked.length || (answers[`prose:${b.id}`]?.noul ?? 1) >= prose) continue;
    const best = asked.map((part) => ({ part, p: answers[`fits:${b.id}:${part}`]?.noul ?? 0 })).sort((a, c) => c.p - a.p)[0]!;
    if (best.p > yes) offers.push({ block: b, part: best.part, p: best.p });
  }
  // Pictures always; the rest the surest first, up to the cap.
  const pictures = offers.filter((o) => o.block.kind === "pictures");
  return [...pictures, ...offers.filter((o) => o.block.kind !== "pictures").sort((a, c) => c.p - a.p).slice(0, cap)];
}

const posts = () => readdirSync(join(dir, "posts")).filter((f) => f.endsWith(".md")).sort().map((f) => {
  const text = readFileSync(join(dir, "posts", f), "utf8");
  return { name: f.replace(/\.md$/, ""), title: /^title: (.*)$/m.exec(text)?.[1] ?? "", blocks: cut(text) };
});

type Label = { at: string; want?: string[]; ok?: string[] };
const labels = parse(readFileSync(join(dir, "labels.yaml"), "utf8")) as Record<string, Label[]>;
const labelOf = (post: string, b: Block) => (labels[post] ?? []).find((l) => b.text.startsWith(l.at));

function score(run: { post: string; answers: Record<string, { noul?: number }>; ms: number }[], yes: number, prose: number, cap: number, print: boolean) {
  let right = 0, wrongOnProse = 0, wrongPart = 0, wanted = 0, found = 0, postsWithRight = 0;
  const lines: string[] = [];
  for (const r of run) {
    const post = posts().find((p) => p.name === r.post)!;
    const offers = decide(post.blocks, r.answers, yes, prose, cap);
    let any = false;
    for (const b of post.blocks) {
      const l = labelOf(post.name, b);
      const o = offers.find((x) => x.block.id === b.id);
      if (l?.want) wanted++;
      if (o && l?.want?.includes(o.part)) found++;
      if (!o) {
        if (l?.want && print) lines.push(`  missed  ${post.name} ${b.id} want ${l.want.join("|")}: ${top(r.answers, b)}  "${b.text.slice(0, 50).replace(/\n/g, " ")}"`);
        continue;
      }
      const fine = l?.want?.includes(o.part) || l?.ok?.includes(o.part);
      if (fine) { right++; any = true; }
      else if (!l) wrongOnProse++;
      else wrongPart++;
      if (print && !fine) lines.push(`  WRONG   ${post.name} ${b.id} ${o.part} ${o.p.toFixed(2)}${l ? ` (want ${[...(l.want ?? []), ...(l.ok ?? [])].join("|")})` : " on plain prose"}: ${top(r.answers, b)}  "${b.text.slice(0, 50).replace(/\n/g, " ")}"`);
    }
    if (any) postsWithRight++;
  }
  const shown = right + wrongOnProse + wrongPart;
  return { shown, right, wrongOnProse, wrongPart, wanted, found, postsWithRight, posts: run.length, lines };
}
const top = (answers: Record<string, { noul?: number }>, b: Block) =>
  `prose ${(answers[`prose:${b.id}`]?.noul ?? NaN).toFixed(2)}, ` +
  candidates(b).map((p) => `${p} ${(answers[`fits:${b.id}:${p}`]?.noul ?? NaN).toFixed(2)}`).join(" ");

const [command = "count", arg] = process.argv.slice(2);
if (command === "count") {
  let n = 0, chars = 0;
  for (const p of posts()) {
    const q = questions(p.blocks);
    n += Object.keys(q).length;
    chars += JSON.stringify(state(p.title, p.blocks)).length;
    console.log(`${p.name.padEnd(16)} ${String(p.blocks.length).padStart(3)} blocks ${String(Object.keys(q).length).padStart(3)} questions  ${p.blocks.map((b) => `${b.id}:${b.kind}${labelOf(p.name, b) ? "*" : ""}`).join(" ")}`);
  }
  console.log(`${posts().length} requests, ${n} questions, ${chars} characters of state`);
} else if (command === "run") {
  const run = [];
  for (const p of posts()) {
    const got = await askRaw(state(p.title, p.blocks), questions(p.blocks));
    console.log(`${p.name.padEnd(16)} ${Math.round(got.ms)} ms  ${JSON.stringify((got.response as { usage?: unknown }).usage ?? {})}`);
    run.push({ post: p.name, ms: got.ms, model: got.model, answers: got.answers, request: got.request, response: got.response });
  }
  mkdirSync(join(dir, "runs"), { recursive: true });
  const file = join(dir, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(run, null, 1));
  console.log(file);
} else if (command === "score") {
  const runs = readdirSync(join(dir, "runs")).sort();
  const file = join(dir, "runs", arg ?? runs.at(-1)!);
  const run = JSON.parse(readFileSync(file, "utf8"));
  console.log(`${file}\nmedian ${Math.round(run.map((r: { ms: number }) => r.ms).sort((a: number, b: number) => a - b)[Math.floor(run.length / 2)])} ms a post`);
  for (const yes of [0.6, 0.7, 0.8, 0.9]) for (const prose of [0.3, 0.5, 1.01]) {
    const s = score(run, yes, prose, 3, false);
    console.log(`yes>${yes} prose<${prose === 1.01 ? "any" : prose} cap 3: shown ${s.shown}, right ${s.right}, wrong on prose ${s.wrongOnProse}, wrong part ${s.wrongPart}, found ${s.found}/${s.wanted} wanted, posts with a right offer ${s.postsWithRight}/${s.posts}`);
  }
  const s = score(run, 0.8, 0.5, 3, true);
  console.log("\nat yes>0.8 prose<0.5 cap 3:\n" + s.lines.join("\n"));
}
