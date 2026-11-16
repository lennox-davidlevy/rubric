// A site's own parts, and the drafts the writer is looking at.
//
// A part of the site's own is a folder in parts/ at the site's root, committed
// with the site: part.yaml (its name and what catalog.yaml would say about it),
// part.html (its drawing, a partial like the catalog's _partials/parts/), and
// part.css, which reads slots only, so the part works in every theme. A draft
// has the same files, in .rubric/drafts/<id>/, with state.json beside them.
//
// Hugo sees both through .rubric/hugo/, which the server writes and the site's
// hugo.toml mounts: the shortcode, the drawing and the CSS where the catalog
// keeps its own, and every entry in data/siteparts.json. The catalog's
// templates read that beside catalog.yaml.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { hugoPath } from "./hugo.ts";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import { CatalogError, missingSettings, parseCatalog, parseOwnPart, PLAIN, splitVariant, writeWhole, type Catalog, type Part } from "./core/index.ts";

export type DraftStatus = "drafting" | "ready" | "failed";

export interface DraftState {
  id: string;
  // What the `::: new:` line asks for.
  words: string;
  status: DraftStatus;
  // The part's name once drafted.
  name?: string;
  // Why it failed.
  message?: string;
  started: number;
  finished?: number;
  // The tool and model that drafted it.
  by?: string;
  // When the writer moved to this take, of several for the same words.
  chosen?: number;
  // Another take of the site's own part of this name, which keeps the name;
  // `words` is then the part's description.
  of?: string;
  // A new variant of the part of this name (core/variant.ts); `words` is
  // then the change, which stays on the line after its ":" while it drafts.
  variant?: string;
  // The site's part as it was kept, the first take of it: keeping it
  // changes nothing.
  original?: true;
  // For the record, to study how the tools and the brief do (docs/plan.md,
  // step 7): what kind of draft, the drafter in parts, the brief's version,
  // the runs it took (2 when the checks sent it back), what they cost, and
  // whether it went on with the last take's conversation.
  kind?: "first" | "another" | "change";
  // What a reroll was asked to change, in the writer's words: the notes are
  // the record of what a draft got wrong.
  change?: string;
  // What the words ask for, as Jev judged each kind (`TRAITS` in
  // questions.ts); a take carries its first draft's.
  traits?: Record<string, number>;
  // How it was asked for: one turn with the files in the reply, or with tools.
  mode?: "fast" | "tools";
  drafter?: { harness: string; model?: string; effort?: string };
  brief?: string;
  runs?: number;
  // How many times the checks refused it; none when they never ran.
  refused?: number;
  stats?: { turns?: number; cost?: number; input?: number; cached?: number; output?: number; thinking?: number; apiSeconds?: number };
  resumed?: boolean;
  // The tool's conversation, for the next take to go on with.
  session?: { id: string; harness: "claude" | "opencode"; model?: string; cwd: string };
}

// What a draft is for, which its takes share: a `new:` line's words, or the
// site's own part it redrafts. Words never start with a NUL.
export function draftKey(d: Pick<DraftState, "words" | "of" | "variant">): string {
  return d.variant !== undefined ? variantKey(d.variant, d.words) : d.of !== undefined ? ownKey(d.of) : d.words;
}

export function ownKey(name: string): string {
  return `\0${name}`;
}

export function variantKey(of: string, words: string): string {
  return `\0${of}\0${words}`;
}

// The takes for a line, oldest first: every finished draft for it, which the
// writer cycles between.
export function takesFor(drafts: Iterable<DraftState>, key: string): DraftState[] {
  return [...drafts].filter((d) => draftKey(d) === key && d.status === "ready").sort((a, b) => a.started - b.started);
}

// The take the preview draws: the one the writer last moved to, or the
// newest to finish, whichever came later.
export function shownTake(drafts: Iterable<DraftState>, key: string): DraftState | undefined {
  const when = (d: DraftState) => Math.max(d.chosen ?? 0, d.finished ?? d.started);
  return takesFor(drafts, key).reduce<DraftState | undefined>((best, d) => (!best || when(d) > when(best) ? d : best), undefined);
}

export interface Own {
  part: Part;
  dir: string;
}

export const DRAFTS = ".rubric/drafts";
// Every draft once the writer is done with it, kept, cancelled, stopped or
// replaced, with its brief, files and logs, so how the tools behave can be
// looked back on; and a line for each in DRAFT_INDEX.
export const DRAFT_LOGS = ".rubric/logs/drafts";
export const DRAFT_INDEX = ".rubric/logs/drafts.jsonl";
export const HUGO_TREE = ".rubric/hugo";
const HUGO_DIRS = ["layouts/_shortcodes", "layouts/_partials/parts", "assets/css/parts", "assets/js/parts", "data"];

// What a part's drawing may not do, as the checks hold a draft to it.
export function drawingProblems(html: string): string[] {
  const problems: string[] = [];
  if (/<script/i.test(html)) problems.push("part.html: no scripts");
  if (/\b(src|srcset)=["']?(https?:)?\/\//i.test(html) || /url\(\s*["']?(https?:)?\/\//i.test(html)) problems.push("part.html: nothing fetched from another site");
  if (/\b(resources\.GetRemote|GetRemote|readFile|readDir|os\.ReadFile|os\.ReadDir|getenv|os\.Getenv)\b/.test(html)) problems.push("part.html: no reading files, the environment or other sites from the template");
  return problems;
}

// Whether the site may have its own drawing of the catalog's part `name`: a
// part in the writing, with no script, since a site's part brings none, and
// whose drawing a take could keep and still pass the checks (a map or a
// video fetches from another site, which a draft may not). `shared` is the
// catalog as catalog.yaml has it, without a skin's additions; `themeDir`,
// when given, is where its drawing is read from.
const drawable = new Map<string, boolean>();
export function changeable(shared: Catalog, name: string, themeDir?: string): boolean {
  const p = Object.hasOwn(shared.parts, name) ? shared.parts[name]! : undefined;
  if (p === undefined || p.place !== "writing" || p.script) return false;
  if (themeDir === undefined) return true;
  const file = join(themeDir, "layouts/_partials/parts", `${name}.html`);
  if (!drawable.has(file)) drawable.set(file, drawingProblems(existsSync(file) ? readFileSync(file, "utf8") : "").length === 0);
  return drawable.get(file)!;
}

// The site's parts and its finished drafts, checked against the catalog. One
// that does not parse is left out and said why. A site's part named
// `<part>--<name>` is a variant of that part (core/variant.ts), which must
// take every setting the part does; it is never the catalog's own name.
// `shared` is the catalog as catalog.yaml has it; `themeDir`, when given, is
// where its drawings are read from.
export function readOwn(root: string, catalog: Catalog, shared: Catalog = catalog, themeDir?: string): { own: Record<string, Own>; problems: string[] } {
  const own: Record<string, Own> = {};
  const problems: string[] = [];
  const add = (dir: string, origin: "site" | "draft") => {
    const file = join(dir, "part.yaml");
    if (!existsSync(file)) return;
    try {
      const { name, part } = parseOwnPart(readFileSync(file, "utf8"), catalog);
      if (Object.hasOwn(own, name) || Object.hasOwn(catalog.parts, name)) throw new CatalogError(`${name} is already a part`);
      const v = splitVariant(name);
      if (v) {
        // Held to catalog.yaml's settings, not a skin's additions: a variant
        // is the site's, whatever the theme.
        const base = Object.hasOwn(catalog.parts, v.of) && changeable(shared, v.of, themeDir) ? shared.parts[v.of]
          : own[v.of]?.part.origin === "site" && own[v.of]!.part.variant === undefined ? own[v.of]!.part : undefined;
        if (!base) throw new CatalogError(`${v.of} is not a part that can have variants`);
        if (v.name === PLAIN) throw new CatalogError(`${PLAIN} is ${v.of} with no variant`);
        const behind = missingSettings(base, part);
        if (behind.length) throw new CatalogError(`${v.of} has ${behind.join(", ")}, which this variant lacks, so lines asking for it show as text`);
        own[name] = { part: { ...part, origin, variant: v.of }, dir };
        return;
      }
      own[name] = { part: { ...part, origin }, dir };
    } catch (err) {
      problems.push(`${relative(root, file)}: ${(err as Error).message}`);
    }
  };
  // In order, so a part comes before its variants.
  for (const name of folders(join(root, "parts"))) add(join(root, "parts", name), "site");
  // Only the take on screen for each line: takes of the same words may share
  // a name. Another take of a site's part is drawn in its place; a new
  // variant's, only on its line; a line's part as it was, as itself.
  const drafts = readDrafts(root);
  for (const key of new Set(drafts.map(draftKey))) {
    const shown = shownTake(drafts, key);
    if (!shown) continue;
    if (shown.variant !== undefined) {
      if (!shown.original) add(join(root, DRAFTS, shown.id), "draft");
    } else if (shown.of !== undefined) {
      if (shown.name !== shown.of || !Object.hasOwn(own, shown.of)) continue;
      const kept = own[shown.of];
      delete own[shown.of];
      add(join(root, DRAFTS, shown.id), "site");
      if (!Object.hasOwn(own, shown.of) && kept) own[shown.of] = kept;
    } else add(join(root, DRAFTS, shown.id), "draft");
  }
  return { own, problems };
}

export function readDrafts(root: string): DraftState[] {
  return folders(join(root, DRAFTS)).flatMap((id) => {
    try {
      const state = JSON.parse(readFileSync(join(root, DRAFTS, id, "state.json"), "utf8")) as DraftState;
      // Left by a version that asked whether the catalog had the part: not a draft.
      return (state.status as string) === "exists" ? [] : [state];
    } catch {
      return [];
    }
  });
}

function folders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

// Every part's shortcode is the same two lines: the catalog's partial does
// the rest, as for the catalog's own parts.
export const SHORTCODE = `{{- /* Naming .Inner here lets Hugo accept the closing call every part gets. */ -}}
{{- $_ := .Inner -}}
{{- partial "rubric/shortcode.html" . -}}
`;

// The files Hugo needs for these parts, by path under .rubric/hugo/.
export function hugoFiles(own: Record<string, Own>): Record<string, string> {
  const files: Record<string, string> = {};
  const entries: Record<string, unknown> = {};
  for (const [name, { dir }] of Object.entries(own)) {
    const { name: _, ...entry } = parse(readFileSync(join(dir, "part.yaml"), "utf8")) as Record<string, unknown>;
    entries[name] = entry;
    files[`layouts/_shortcodes/${name}.html`] = SHORTCODE;
    files[`layouts/_partials/parts/${name}.html`] = readFileSync(join(dir, "part.html"), "utf8");
    if (existsSync(join(dir, "part.css"))) files[`assets/css/parts/${name}.css`] = readFileSync(join(dir, "part.css"), "utf8");
  }
  files["data/siteparts.json"] = JSON.stringify(entries, null, 2) + "\n";
  return files;
}

// Writes .rubric/hugo/ for these parts, each file whole, and takes away what
// is no longer there unless `prune` is false: a page may still call a part
// that's going until it is drawn again. Unchanged files are left alone, so
// Hugo rebuilds only for a real change.
export async function writeHugoTree(root: string, own: Record<string, Own>, prune = true): Promise<void> {
  const base = join(root, HUGO_TREE);
  const tmp = join(root, ".rubric/tmp");
  // Every folder, even empty: Hugo leaves out a mounted folder that isn't
  // there when it starts, and never sees what is written there later.
  for (const dir of HUGO_DIRS) await mkdir(join(base, dir), { recursive: true });
  const files = hugoFiles(own);
  for (const [path, text] of Object.entries(files)) {
    const target = join(base, path);
    const was = await readFile(target, "utf8").catch(() => undefined);
    if (was !== text) await writeWhole(target, text, tmp);
  }
  if (!prune) return;
  const there = existsSync(base) ? (await readdir(base, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()) : [];
  for (const e of there) {
    const path = relative(base, join(e.parentPath, e.name));
    if (!Object.hasOwn(files, path)) await rm(join(base, path), { force: true });
  }
}

const PART_FILES = ["part.yaml", "part.html", "part.css"];

// Keeps a draft as the site's own part: its files into parts/<name>/.
export async function keepLocal(root: string, dir: string, name: string): Promise<void> {
  const target = join(root, "parts", name);
  if (existsSync(target)) throw new Error(`parts/${name} already exists`);
  await mkdir(target, { recursive: true });
  for (const f of PART_FILES) if (existsSync(join(dir, f))) await copyFile(join(dir, f), join(target, f));
}

// Another take of the site's part `name` replaces its files in parts/<name>/.
export async function keepTake(root: string, dir: string, name: string): Promise<void> {
  const target = join(root, "parts", name);
  if (!existsSync(target)) throw new Error(`parts/${name} is not there any more`);
  const tmp = join(root, ".rubric/tmp");
  for (const f of PART_FILES) {
    if (existsSync(join(dir, f))) await writeWhole(join(target, f), await readFile(join(dir, f), "utf8"), tmp);
    else await rm(join(target, f), { force: true });
  }
}

// Makes the variant `name` of the part `of` the one drawn for every line of
// it that sets none, or, with no name, none of them: `everywhere: true` in
// its part.yaml, and in no other variant's of the part.
export async function setEverywhere(root: string, of: string, name?: string): Promise<void> {
  const tmp = join(root, ".rubric/tmp");
  for (const folder of variantsOf(root, of)) {
    const file = join(root, "parts", folder, "part.yaml");
    const doc = parseDocument(await readFile(file, "utf8"));
    const on = folder === name;
    if (on === (doc.get("everywhere") === true)) continue;
    if (on) doc.set("everywhere", true);
    else doc.delete("everywhere");
    await writeWhole(file, doc.toString(), tmp);
  }
}

// A catalog part's files as a site's part has them: its entry from
// catalog.yaml with `name:` first, its drawing and its CSS. With `skin`, the
// skin's own drawing of it when it has one, which is what the site shows.
export function catalogFiles(themeDir: string, name: string, skin?: string): { yaml: string; html: string; css: string } | undefined {
  const raw = (parse(readFileSync(join(themeDir, "catalog.yaml"), "utf8")) as { parts?: Record<string, unknown> } | undefined)?.parts ?? {};
  if (!Object.hasOwn(raw, name)) return undefined;
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim() : "");
  return {
    yaml: stringify({ name, ...(raw[name] as object) }).trim(),
    html: read(skin && existsSync(join(themeDir, "layouts/_partials/skins", skin, "parts", `${name}.html`))
      ? join(themeDir, "layouts/_partials/skins", skin, "parts", `${name}.html`)
      : join(themeDir, "layouts/_partials/parts", `${name}.html`)),
    css: read(join(themeDir, "assets/css/parts", `${name}.css`)),
  };
}

// Where a site's part goes when the writer removes it, or puts it in the
// catalog: kept in the record, never deleted outright.
export const REMOVED = ".rubric/logs/removed";

// The site's variants of the part `of`, by their folders' names.
export function variantsOf(root: string, of: string): string[] {
  return folders(join(root, "parts")).filter((f) => splitVariant(f)?.of === of);
}

export async function putAway(root: string, name: string): Promise<string> {
  const to = join(root, REMOVED, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(join(root, REMOVED), { recursive: true });
  await rename(join(root, "parts", name), to);
  return relative(root, to);
}

// Puts a part into the catalog, for every theme and site: its entry at the
// end of catalog.yaml with the version bumped, its drawing, CSS and shortcode
// where the catalog's own are, and its starter as the catalog page's sample.
// Then the catalog page is built in every theme; if Hugo refuses it, every
// file goes back as it was. Returns the catalog's new version.
export async function makeGlobal(themeDir: string, dir: string, name: string): Promise<number> {
  const catalogFile = join(themeDir, "catalog.yaml");
  const samplesFile = join(themeDir, "samples.yaml");
  const was = { catalog: await readFile(catalogFile, "utf8"), samples: await readFile(samplesFile, "utf8").catch(() => undefined) };
  const { name: _, ...entry } = parse(await readFile(join(dir, "part.yaml"), "utf8")) as Record<string, unknown>;
  // parts: is the last key, so the entry goes at the end, under it.
  const lines = was.catalog.split("\n");
  const partsAt = lines.findIndex((l) => /^parts:\s*$/.test(l));
  if (partsAt < 0 || lines.slice(partsAt + 1).some((l) => /^[a-z]/.test(l))) throw new Error("catalog.yaml does not end with its parts, so the new one has nowhere to go");
  const version = Number(/^version:\s*(\d+)/m.exec(was.catalog)?.[1]);
  if (!Number.isInteger(version)) throw new Error("catalog.yaml has no version");
  // Where it came from stays with it, in the catalog.
  entry.drafted = true;
  const indented = stringify(entry).trimEnd().split("\n").map((l) => `    ${l}`).join("\n");
  const catalog = `${was.catalog.trimEnd().replace(/^version:\s*\d+/m, `version: ${version + 1}`)}\n\n  ${name}:\n${indented}\n`;

  const written = [
    join(themeDir, "layouts/_shortcodes", `${name}.html`),
    join(themeDir, "layouts/_partials/parts", `${name}.html`),
    join(themeDir, "assets/css/parts", `${name}.css`),
  ];
  for (const f of written) if (existsSync(f)) throw new Error(`${relative(themeDir, f)} already exists`);
  try {
    // The catalog must still read as one before anything changes.
    parseCatalog(catalog);
    const tmp = join(themeDir, ".rubric-tmp");
    await writeWhole(written[0]!, SHORTCODE, tmp);
    await writeWhole(written[1]!, await readFile(join(dir, "part.html"), "utf8"), tmp);
    if (existsSync(join(dir, "part.css"))) await writeWhole(written[2]!, await readFile(join(dir, "part.css"), "utf8"), tmp);
    await writeWhole(catalogFile, catalog, tmp);
    const body = typeof entry.body === "string" ? entry.body : undefined;
    if (was.samples !== undefined && body) {
      await writeWhole(samplesFile, `${was.samples.trimEnd()}\n\n${name}:\n  md: |\n${body.trimEnd().split("\n").map((l) => `    ${l}`).join("\n")}\n`, tmp);
    }
    await rm(tmp, { recursive: true, force: true });
    const page = join(themeDir, "page");
    const hugo = hugoPath();
    if (hugo && existsSync(page)) {
      const out = join(tmpdir(), `rubric-global-${name}-${Date.now()}`);
      try {
        // Not --quiet, which hides Hugo's errors too.
        const proc = Bun.spawn([hugo, "-s", page, "-d", out], { stdout: "ignore", stderr: "pipe" });
        const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
        const errors = stderr.split("\n").filter((l) => /ERROR/.test(l));
        if (code !== 0 || errors.length) throw new Error(`the catalog page does not build with it: ${(errors.join(" ") || `exit ${code}`).slice(0, 600)}`);
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    }
    return version + 1;
  } catch (err) {
    for (const f of written) await rm(f, { force: true });
    await writeFile(catalogFile, was.catalog);
    if (was.samples !== undefined) await writeFile(samplesFile, was.samples);
    await rm(join(themeDir, ".rubric-tmp"), { recursive: true, force: true });
    throw err;
  }
}
