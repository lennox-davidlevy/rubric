// Drafting a part the catalog doesn't have, for a `::: new:` line: a brief
// for the writer's harness (Claude Code, run headless), the harness run in a
// folder of its own under .rubric/drafts/, and the checks the draft has to
// pass before the writer sees it. docs/plan.md, step 7.
//
// The draft reads slots only, as the catalog's parts do, so it can go global
// later with a check and no rewrite.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { NAME, parseOwnPart, writeWhole } from "../core/index.ts";
import { draftKey, DRAFTS, hugoFiles, readDrafts, type DraftState } from "../parts.ts";
import type { Site } from "../site.ts";
import { lint } from "../theme.ts";
import type { Drafter, RunStats, Session } from "./harness.ts";

// Runs the harness in `dir` with `prompt`; resolves when it is done. The
// files it wrote are the answer; an error is why there are none. What it
// does as it goes is told to `log`, a line at a time.
// `use` is a drafter for this draft alone, in place of the writer's default.
// `resume` is an earlier conversation to go on with, when the same tool and
// model draft. It answers with what the run cost, the drafter it ran with,
// and its own session, to go on with later.
export type Harness = (
  dir: string, prompt: string, signal: AbortSignal, log?: (line: string) => void, use?: Drafter, resume?: Session,
) => Promise<{ error?: string; stats?: RunStats; session?: Session; drafter?: Drafter; resumed?: boolean; runs?: number }>;

// What a draft did, as it happens, for the writer to read: in the draft's
// folder, a line a step, each with the time since it started.
export const LOG = "draft.log";

export function draftLog(dir: string, started: number): { log: (line: string) => void; flush: () => Promise<void> } {
  let queue = Promise.resolve();
  const log = (line: string) => {
    const secs = Math.max(0, Math.round((Date.now() - started) / 1000));
    const at = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const text = line.split("\n").map((l, i) => (i === 0 ? `${at}  ${l}` : `      ${l}`)).join("\n") + "\n";
    queue = queue.then(() => appendFile(join(dir, LOG), text)).catch(() => {});
  };
  return { log, flush: () => queue };
}

export const NOT_MOUNTED = "this site's hugo.toml does not mount .rubric/hugo/, where its own parts and drafts are drawn from; copy the [[module.mounts]] in testing/hugo.toml";

export const PROMPT = "Read brief.md in this folder and do what it asks. Write only the files it names, in this folder.";

// Another take's prompt says what is asked, so a model going on with its
// earlier conversation, which read an earlier brief, knows this one is new.
export function takePrompt(change: string): string {
  return `The writer wants another take of the part${change ? `, with this change: "${change}"` : ", drawn another way"}. brief.md in this folder is new for it: read it again before anything else, then do what it asks. Write only the files it names, in this folder.`;
}

// The brief's version, in the record: changes whenever its wording, its
// examples or the prompt do, or the catalog and theme it shows, so runs can
// be compared brief against brief.
export function briefVersion(site: Pick<Site, "theme"> & { catalog: { version: number } }): string {
  return createHash("sha1").update(brief.toString()).update(JSON.stringify(EXAMPLES)).update(PROMPT).update(takePrompt.toString())
    .update(`${site.catalog.version} ${site.theme}`).digest("hex").slice(0, 8);
}

// A part's files, in a draft's folder or the site's parts/.
export const PART_FILES = ["part.yaml", "part.html", "part.css"];

// Parts whose files the brief shows as examples, each for what it teaches.
// Chosen from what drafts got wrong or left out (docs/plan.md, step 7):
// a starter that matches the drawing, settings for a quantity and a manner,
// and decoration in CSS alone, with no controls.
export const EXAMPLES: [string, string][] = [
  ["steps", "Children drawn as a structure: each `###` in the block becomes a numbered item, through the catalog's `rubric/sections.html` helper, and the `body` starter has the `###`s, so the writer sees what to write."],
  ["cards", "Settings for a quantity (`columns`) and a manner (`edge`), each a `choice` turned into a class on the outer element, with CSS for each value."],
  ["divider", "Decoration in CSS alone: no controls, no script, a `style` setting for the look, and `empty: true` since it holds nothing."],
];

export interface DraftRequest {
  words: string;
  // What the writer has already written in the block.
  inside: string;
  // Reroll: what to change about the last draft, and where it is. With no
  // change, a different take.
  previous?: { dir: string; change: string };
  // Drafted though the catalog has a part for it: the writer saw that part
  // and wants one of their own.
  fresh?: boolean;
  // Another take of the site's own part of this name, which keeps it; the
  // words are its description, and `previous` the take it starts from.
  of?: string;
  // The drafter for this draft alone, in place of the writer's default.
  use?: Drafter;
  // The take it starts from's conversation, to go on with.
  resume?: Session;
}

// The brief: what to make, what the site looks like, and how a part is put
// together, with examples from the catalog.
export function brief(site: Site, req: DraftRequest): string {
  const catalog = site.catalog;
  const themes = (readYaml(join(site.themeDir, "themes.yaml")) ?? {}) as Record<string, { description?: string; palette?: string; pairing?: string; scale?: string; skin?: string }>;
  const theme = themes[site.theme] ?? {};
  const piece = (kind: string, name?: string) => (name ? readText(join(site.themeDir, "themes", kind, `${name}.yaml`)) : undefined);
  const raw = (readYaml(join(site.themeDir, "catalog.yaml")) as { parts?: Record<string, unknown> } | undefined)?.parts ?? {};
  const parts = Object.entries(catalog.parts).filter(([, p]) => p.place === "writing" && p.origin !== "draft");
  const examples = EXAMPLES.filter(([n]) => raw[n]).map(([n, why]) => [
    `### ${n}`,
    why,
    "part.yaml:", fence("yaml", stringify({ name: n, ...(raw[n] as object) }).trim()),
    "part.html:", fence("html", readText(join(site.themeDir, "layouts/_partials/parts", `${n}.html`))?.trim() ?? ""),
    "part.css:", fence("css", readText(join(site.themeDir, "assets/css/parts", `${n}.css`))?.trim() ?? ""),
  ].join("\n"));

  const asked = req.of
    ? `The writer has a part of their own, **${req.of}**, and wants another take of it. What it is:`
    : "The writer asked for a part the catalog does not have:";
  // Another take starts from the last one, whose files are already in the
  // folder and shown here: the catalog's list and its examples would only
  // say again what that take already settled.
  const prev = req.previous;
  const previousFiles = prev ? PART_FILES.map((f) => {
    const text = readText(join(prev.dir, f));
    return text === undefined ? "" : `${f}:\n${fence(f.split(".")[1]!, text.trim())}`;
  }).filter(Boolean).join("\n") : "";
  const again = prev
    ? `## This is another take\n\n${prev.change
      ? `The writer looked at the last take and asked for this change: "${prev.change}". Its files are already in this folder, as they are below. Make the change with edits to them, and leave everything the change doesn't need as it is.`
      : "The writer looked at the last take and wants a different one: another way to draw the same thing. Its files are in this folder, as they are below; write your own take over them."}\n\n${previousFiles}\n`
    : "";
  const catalogSection = prev ? "" : req.fresh
    ? "## The catalog's parts\n\nThe writer has seen the catalog's nearest part and wants one of their own anyway, so draft it. Make it plainly different from these:"
    : "## Is it already in the catalog?\n\nThese are the parts the catalog has. If one of them already does what the writer asked, write only `exists.txt` in this folder: the part's name on the first line, then one sentence saying why it fits. Write nothing else. Only do this when the part really does what they asked, not something near it.";
  const naming = req.of
    ? `\`name\`: \`${req.of}\`, as it is now. Pages already use it by that name.`
    : prev
      ? "`name`: as it is, unless the change asks for another; lowercase letters, digits and hyphens, and not a name the catalog has."
      : "`name`: lowercase letters, digits and hyphens, short, naming what it is (`timeline`, not `my-timeline-part`). Not one of the names above.";

  return `# Draft a new part for a Rubric site

Rubric turns writing into a website. A writer puts a line like \`::: quote\` in a Markdown page, and a part from a catalog is drawn there by Hugo. ${asked}

> ${req.words || "(no words yet)"}
${req.inside.trim() ? `\nWhat they have already written inside its block, which the part should draw well:\n\n${fence("markdown", req.inside.trim())}\n` : ""}${again ? `\n${again}` : ""}${catalogSection ? `
${catalogSection}

${parts.map(([n, p]) => `- ${n}: ${p.description}`).join("\n")}
` : ""}
## ${prev ? "The part's files" : "Otherwise, write the part"}

Write these files in this folder, and nothing else:

1. **part.yaml**: \`name:\` and the part's entry${prev ? "" : ", as in the examples below"}.
   - ${naming}
   - \`description\`: one plain sentence saying what the part is, in words a writer would use. A small model reads it to decide when to pick this part, so say what it is and nothing a writer would not say.
   - \`children: true\` if the block holds Markdown the part draws (most do). \`empty: true\` instead for a part that takes nothing inside.
   - \`settings\`: for a real variation the writer might ask for. When the words name a quantity, a speed, a direction, a size or a style ("a ring of moons", "a slow scroll"), offer it as a setting (\`count\`, \`pace\`); one or two, not more. Each \`choice\` has a \`default\` and at least two \`values\`, each a few words saying what it does. Value and setting names are lowercase with hyphens. None named ${Object.keys(catalog.look).join(", ")}: every part already has those.
   - \`body\`: a short starter written into an empty block, so the writer sees what the part expects. It has exactly the structure the drawing reads: if part.html draws each \`###\` as a step, the starter has the \`###\`s. It never commits to content (\`### When: What happened\`, not \`### 2024\`).
2. **part.html**: the drawing, a Hugo partial. It gets \`.s\` (every setting, defaults filled in), \`.inner\` (the block's Markdown, already rendered to HTML), \`.raw\` (the block's Markdown as written) and \`.page\`. The outer element's class attribute starts with \`part part-<name>\`, so the theme can add classes to it. Turn settings into classes (\`size-{{ .s.size }}\`). To draw the block's \`###\` sections as items, use \`partial "rubric/sections.html" (dict "html" .inner "level" 3)\`: it gives \`.items\`, each with \`.title\` and \`.body\`, and \`.before\`, what comes before the first.
3. **part.css**: the part's CSS. Every rule starts with \`.part-<name>\`.

## Rules

- **Slots only.** Colors, fonts, weights, sizes and spaces come from the theme's slots, as \`var(--name)\`: never a literal color (\`#333\`, \`rgb()\`, \`white\`), font family or numeric font weight. Custom properties of your own are fine, set in part.css or inline in part.html (\`style="--angle: 40deg"\`). The slots: ${catalog.slots.join(", ")}.
- Use \`paper\`, \`ink\`, \`accent\`, \`muted\`, \`rule\`, \`tint\` and \`raised\` for ordinary parts: dark mode swaps their values for you. The \`dark-*\` slots are only for a part that is itself a dark band.
- It has to work in every theme and at every width from 360px: no fixed widths that can scroll sideways, and writing that stays readable on the grounds you choose.
- No script, nothing fetched from another site, no images of your own. HTML and CSS only.
- No controls (buttons, checkboxes, inputs) unless the words ask for something the reader works. Motion respects \`prefers-reduced-motion\` on its own.
- American English.
- Make it look good. This is the writer's site.

## The site it is for

The site's theme is **${site.theme}**${theme.description ? `: ${theme.description}` : ""}. Draw the part so it belongs here, but through the slots only, so it works in any theme.
${[["palette", "palettes", theme.palette], ["pairing", "pairings", theme.pairing], ["scale", "scales", theme.scale]].map(([label, kind, name]) => {
    const text = piece(kind!, name);
    return text ? `\nIts ${label}, **${name}**:\n\n${fence("yaml", text.trim())}\n` : "";
  }).join("")}
${prev ? "" : `## Examples from the catalog

${examples.join("\n\n")}

`}## When you are done

Reply with one sentence: what you made, or what you changed. Nothing else; the files say the rest.
`;
}

// Checks a draft: its entry, its CSS against the slots, and that Hugo draws
// it in the site's theme with each value of each setting. Returns the part's
// name, or what is wrong.
export async function checkDraft(site: Site, dir: string, words?: string, of?: string): Promise<{ name?: string; problems: string[] }> {
  const problems: string[] = [];
  const text = await readFile(join(dir, "part.yaml"), "utf8").catch(() => undefined);
  if (text === undefined) return { problems: ["there is no part.yaml"] };
  let name: string;
  let parsed: ReturnType<typeof parseOwnPart>;
  try {
    parsed = parseOwnPart(text, site.catalog);
    name = parsed.name;
  } catch (err) {
    return { problems: [`part.yaml: ${(err as Error).message}`] };
  }
  if (of !== undefined) {
    // Another take of a site's part keeps its name: pages use it.
    if (name !== of) problems.push(`part.yaml: the name must stay ${of}, which pages already use`);
  } else {
    // A draft for the same words is the one this replaces; any other part,
    // or another line's draft, has the name already.
    const taken = site.catalog.parts[name];
    const same = taken?.origin === "draft" && words !== undefined && draftWords(site.own[name]?.dir) === words;
    // A take of other words that isn't on screen has its name too, even
    // though it isn't in the catalog now.
    const elsewhere = readDrafts(site.root).some((d) => d.name === name && d.status === "ready" && draftKey(d) !== words);
    if ((taken && !same) || elsewhere) problems.push(`part.yaml: ${name} is already a part; choose another name`);
  }
  if (!NAME.test(name)) problems.push(`part.yaml: ${name} is not a name`);

  const html = await readFile(join(dir, "part.html"), "utf8").catch(() => undefined);
  if (html === undefined) problems.push("there is no part.html");
  else {
    if (!new RegExp(`class="part part-${name}[ "]`).test(html)) problems.push(`part.html: the outer element's class must start with "part part-${name}"`);
    if (/<script/i.test(html)) problems.push("part.html: no scripts");
    if (/\b(src|srcset)=["']?(https?:)?\/\//i.test(html) || /url\(\s*["']?(https?:)?\/\//i.test(html)) problems.push("part.html: nothing fetched from another site");
    if (/\b(resources\.GetRemote|GetRemote|readFile|readDir|os\.ReadFile|os\.ReadDir|getenv|os\.Getenv)\b/.test(html)) problems.push("part.html: no reading files, the environment or other sites from the template");
  }
  const css = await readFile(join(dir, "part.css"), "utf8").catch(() => undefined);
  if (css === undefined) problems.push("there is no part.css");
  else {
    // A property the HTML sets inline is the part's own, as one part.css sets.
    const inline = [...(html ?? "").matchAll(/(?:^|[\s;"'{])--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
    for (const p of lint({ slots: site.catalog.slots } as Parameters<typeof lint>[0], { "part.css": css }, inline)) {
      // Said for the draft: there is no catalog.yaml in its folder to look in.
      if (p.level === "error") problems.push(`${p.where}: ${p.message.replace(/ is not a slot in catalog\.yaml$/, " is not one of the theme's slots, and neither part.css nor part.html sets it; set it in one of them, or use a slot")}`);
    }
    if (/url\(\s*["']?(https?:)?\/\//i.test(css) || /@import/i.test(css)) problems.push("part.css: nothing fetched from another site");
  }
  if (problems.length > 0) return { name, problems };

  problems.push(...(await hugoCheck(site, dir, name, parsed.part)));
  return { name, problems };
}

// Builds a page with the part on it, once for each value of each setting, in
// a throwaway copy of the site's config, and reads what Hugo says.
async function hugoCheck(site: Site, dir: string, name: string, part: ReturnType<typeof parseOwnPart>["part"]): Promise<string[]> {
  const hugo = Bun.which("hugo");
  if (!hugo) return [];
  const tmp = join(site.root, ".rubric/tmp", `check-${name}-${Date.now()}`);
  try {
    const config = readFileSync(join(site.root, "hugo.toml"), "utf8")
      .replace(/^themesDir\s*=.*$/m, `themesDir = ${JSON.stringify(join(site.themeDir, ".."))}`);
    await mkdir(join(tmp, "content"), { recursive: true });
    await writeFile(join(tmp, "hugo.toml"), config);
    // The site's own parts and this draft, as the server would mount them.
    const own = Object.fromEntries(Object.entries(site.own).filter(([n, o]) => n !== name && o.part.origin === "site"));
    for (const [path, body] of Object.entries(hugoFiles({ ...own, [name]: { part, dir } }))) {
      await mkdir(join(tmp, ".rubric/hugo", path, ".."), { recursive: true });
      await writeFile(join(tmp, ".rubric/hugo", path), body);
    }
    const inside = part.body ?? "Some writing, with [a link](#) in it.";
    const calls = [""];
    for (const [key, def] of Object.entries(part.settings)) {
      const values = def.type === "choice" ? Object.keys(def.values) : def.type === "level" ? Object.keys(def.levels) : def.type === "flag" ? ["true", "false"] : [];
      for (const v of values) calls.push(` ${key}="${v}"`);
    }
    const blocks = calls.map((s) => (part.empty ? `{{< ${name}${s} />}}` : `{{< ${name}${s} >}}\n${inside}\n{{< /${name} >}}`));
    const front = JSON.stringify({ title: "Check", rubric: { theme: site.theme } });
    await writeFile(join(tmp, "content/check.md"), `${front}\n\nBefore.\n\n${blocks.join("\n\n")}\n\nAfter.\n`);
    // Not --quiet, which hides Hugo's errors too.
    const r = await runHugo([hugo, "-s", tmp, "-d", join(tmp, "public")]);
    const errors = r.stderr.split("\n").filter((l) => /ERROR/.test(l));
    if (r.code !== 0 || errors.length) return [`Hugo could not draw it: ${(errors.join(" ") || r.stderr.trim() || `exit ${r.code}`).replaceAll(tmp, "").slice(0, 600)}`];
    const page = await readFile(join(tmp, "public/check/index.html"), "utf8").catch(() => "");
    if (!page.includes(`part-${name}`)) return ["Hugo drew the page without the part"];
    return [];
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// One draft, start to finish: the brief, the harness, the checks, and one
// more try with the reasons when they fail. `save` is called with each new
// state. The folder is the draft's; the caller made it.
export async function runDraft(site: Site, dir: string, state: DraftState, req: DraftRequest, harness: Harness, signal: AbortSignal, save: (s: DraftState) => Promise<void>): Promise<DraftState> {
  if (!site.ownMounted) {
    const next: DraftState = { ...state, status: "failed", message: NOT_MOUNTED, finished: Date.now() };
    await save(next);
    return next;
  }
  const { log, flush } = draftLog(dir, state.started);
  // What the runs cost, added up; the drafter, the session and whether it
  // resumed, from the last run.
  const kind: DraftState["kind"] = req.previous ? (req.previous.change ? "change" : "another") : req.fresh ? "fresh" : "first";
  const measured: Partial<DraftState> = { kind, brief: briefVersion(site), runs: 0 };
  const add = (r: Awaited<ReturnType<Harness>>) => {
    const first = (measured.runs ?? 0) === 0;
    measured.runs = (measured.runs ?? 0) + (r.runs ?? 1);
    if (r.drafter) measured.drafter = { harness: r.drafter.harness, ...(r.drafter.model ? { model: r.drafter.model } : {}), ...(r.drafter.effort ? { effort: r.drafter.effort } : {}) };
    if (r.session) measured.session = r.session;
    if (r.resumed !== undefined && first) measured.resumed = r.resumed;
    if (r.stats) {
      const total: NonNullable<DraftState["stats"]> = { ...measured.stats };
      for (const [k, v] of Object.entries(r.stats) as [keyof RunStats, number | undefined][]) {
        if (typeof v === "number") total[k] = Math.round(((total[k] ?? 0) + v) * 1000) / 1000;
      }
      measured.stats = total;
    }
  };
  const done = async (s: Partial<DraftState>) => {
    const next: DraftState = { ...state, ...measured, ...s, finished: Date.now() };
    log(next.status === "ready" ? `ready: ${next.name}`
      : next.status === "exists" ? `the catalog has ${next.name} for these words`
      : `failed: ${next.message ?? "no reason given"}`);
    await flush();
    await save(next);
    return next;
  };

  try {
    return await attempts();
  } catch (err) {
    // Whatever went wrong on our side, what was measured stays in the record.
    return await done({ status: "failed", message: (err as Error).message });
  } finally {
    // Every line is on disk before anyone moves or removes the folder.
    await flush();
  }

  async function attempts(): Promise<DraftState> {
  log(req.of ? `another take of ${req.of}${state.by ? ` with ${state.by}` : ""}` : `drafting "${req.words}"${state.by ? ` with ${state.by}` : ""}`);
  // Another take starts from the last one's files, in the folder itself,
  // so a change is a few edits rather than the whole part written again.
  const before: Record<string, string> = {};
  if (req.previous) {
    log(req.previous.change ? `rerolling, with the change: ${req.previous.change}` : "rerolling, for another take");
    for (const f of PART_FILES) {
      const text = await readFile(join(req.previous.dir, f), "utf8").catch(() => undefined);
      if (text === undefined) continue;
      before[f] = text;
      await writeFile(join(dir, f), text);
    }
  }
  if (req.fresh) log("drafting one anyway, though the catalog may have one");
  await writeFile(join(dir, "brief.md"), brief(site, req));

  let prompt = req.previous ? takePrompt(req.previous.change) : PROMPT;
  for (let attempt = 0; attempt < 2; attempt++) {
    // A second try goes on with the first's conversation, which knows the
    // draft it's fixing; a first try, with the take it starts from's.
    const ran = await harness(dir, prompt, signal, log, req.use, attempt === 0 ? req.resume : measured.session);
    add(ran);
    if (signal.aborted) return done({ status: "failed", message: "stopped" });
    if (ran.error) return done({ status: "failed", message: ran.error });

    const exists = await readFile(join(dir, "exists.txt"), "utf8").catch(() => undefined);
    // Only a first draft asks whether the catalog has it; a take doesn't.
    if (exists !== undefined && !req.fresh && req.of === undefined && !req.previous) {
      const [first = "", ...rest] = exists.trim().split("\n");
      const part = first.trim();
      if (Object.hasOwn(site.catalog.parts, part) && site.catalog.parts[part]!.origin !== "draft") {
        return done({ status: "exists", name: part, message: rest.join(" ").trim() });
      }
      await rm(join(dir, "exists.txt"), { force: true });
      log(`it named ${part}, which the catalog doesn't have; asking again`);
      prompt = `exists.txt names "${part}", which is not one of the catalog's parts. Either write the part, or name one that is.`;
      continue;
    }
    // The last take's files, untouched: the tool did nothing. Going on with
    // an earlier conversation, a model may take the work for done; once more
    // without it, then it's a failure.
    if (req.previous && attempt === 0 && Object.keys(before).length > 0) {
      const unchanged = async () => (await Promise.all(PART_FILES.map(async (f) => (await readFile(join(dir, f), "utf8").catch(() => undefined)) === before[f]))).every(Boolean);
      if (await unchanged()) {
        if (!ran.resumed) return done({ status: "failed", message: "the tool changed nothing" });
        log("going on with the last conversation changed nothing; trying once more without it");
        const again = await harness(dir, prompt, signal, log, req.use);
        add(again);
        if (signal.aborted) return done({ status: "failed", message: "stopped" });
        if (again.error) return done({ status: "failed", message: again.error });
        if (await unchanged()) return done({ status: "failed", message: "the tool changed nothing" });
      }
    }
    log("checking the draft, and building it with Hugo");
    const { name, problems } = await checkDraft(site, dir, req.words, req.of);
    measured.refused = (measured.refused ?? 0) + (problems.length > 0 ? 1 : 0);
    if (problems.length === 0) return done({ status: "ready", name: name! });
    log(`the checks refused it:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    if (attempt === 1) return done({ status: "failed", message: problems.join("; ") });
    log("asking for a fix, once");
    prompt = `The checks refused the draft in this folder. Fix it, and change nothing else:\n\n${problems.map((p) => `- ${p}`).join("\n")}\n\nThe brief is still in brief.md.`;
  }
  return done({ status: "failed", message: "no draft" });
  }
}

// Hugo, without holding up the language server while it builds.
export async function runHugo(args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

// The words a draft in `dir` was made for.
function draftWords(dir: string | undefined): string | undefined {
  try {
    return dir ? (JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as DraftState).words : undefined;
  } catch {
    return undefined;
  }
}

// A new draft's folder and first state.
export async function newDraft(root: string, words: string, by?: string, of?: string): Promise<{ dir: string; state: DraftState }> {
  const slug = (of ?? words).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "part";
  const id = `${slug}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(root, DRAFTS, id);
  await mkdir(dir, { recursive: true });
  const state: DraftState = { id, words, status: "drafting", started: Date.now(), ...(by ? { by } : {}), ...(of !== undefined ? { of } : {}) };
  return { dir, state };
}

export function saveState(root: string): (s: DraftState) => Promise<void> {
  return (s) => writeWhole(join(root, DRAFTS, s.id, "state.json"), JSON.stringify(s, null, 2) + "\n", join(root, ".rubric/tmp"));
}

function fence(lang: string, text: string): string {
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function readText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function readYaml(path: string): unknown {
  const text = readText(path);
  return text === undefined ? undefined : parse(text);
}
