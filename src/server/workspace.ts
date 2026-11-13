// Everything the language server does, with no protocol in it: the document
// flow from lsp.md, ghost text, completion and hover. main.ts wires it to the
// editor. Works from the text the editor holds, never from the saved file, and
// only ever writes content/, .rubric/ and nothing the writer edits.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyRefine, atPlace, Cache, frontMatterProblem, liveContent, settingsOf, formatPlain, frame, FRAME_PAGE, framePage, parsePlain, preprocess, refineWords, scan, lines as splitLines,
  formatThemeLine, PIECES, THEME, THRESHOLDS, writeWhole, type Piece,
  type Catalog, type Diagnostic, type Directive, type Entry, type PageKind, type Place, type Refined, type Resolution, type Resolve, type ThemeChoice,
} from "../core/index.ts";
import { catalogFiles, changeable, DRAFT_INDEX, DRAFT_LOGS, draftKey, DRAFTS, keepLocal, keepTake, makeGlobal, ownKey, putAway, readDrafts, shownTake, takesFor, writeHugoTree, type DraftState } from "../parts.ts";
import { openSite, pageKind, pagePath, type Site } from "../site.ts";
import { LOG, newDraft, NOT_MOUNTED, runDraft, saveState, type Harness } from "./draft.ts";
import { brief as shortDrafter, type Drafter, type HarnessName, type Mode } from "./harness.ts";
import { themeList, type ThemeList, type ThemeRanker } from "./themes.ts";
import { fileExists, isSiteAddress, pictures } from "./files.ts";

export type Resolver = (directive: string, page: PageKind) => Promise<{ resolution: Resolution; model: string }>;

// The second pass: words after a pinned part's ":", asked only about that part.
export type Refiner = (words: string, part: string, page: PageKind) => Promise<{ refined?: Refined; error?: string; model: string }>;

export type Severity = "warning" | "information" | "hint";
export interface Note extends Omit<Diagnostic, "code"> {
  code: string;
  severity: Severity;
  // For the editor to draw: a `new:` line's draft, where it is.
  data?: { status: string; name?: string; by?: string; started?: number; shown?: string; take?: number; takes?: number; earlier?: number; close?: number; of?: string };
}

export interface Ghost {
  // Inserted at the end of the line, which is where it is shown.
  text: string;
  line: number;
  character: number;
  // The line as it should read once accepted: the editor replaces the whole
  // line with it. Accepting puts the part in place of the words, which have
  // done their job; the ghost text only shows what is picked.
  replace?: string;
  // A closing ":::" the editor takes away on accepting: the block's, when the
  // part picked takes nothing inside.
  drop?: number;
  // Accepting asks for a new part to be drafted: the line becomes a `new:`
  // line, and the editor then asks the server to start.
  build?: true;
}

// What the editor shows and does for a `::: new:` line.
// How long a `new:` line's menu waits for Jev to say what is near its words.
const NEAR_WAIT_MS = 700;
// How long a finished draft's record waits for what Jev says its words ask for.
const TRAITS_WAIT_MS = 1000;

export interface DraftView {
  words: string;
  // The newest draft for these words, if there is one.
  status?: DraftState["status"];
  name?: string;
  message?: string;
  // A finished draft drawn in the preview while another is being made.
  shown?: string;
  // The newest draft's log, a path, to follow what it does.
  log?: string;
  // Which take is on screen, from 1, of how many finished ones.
  take?: number;
  takes?: number;
  // When there are several: each take, oldest first, so take 1 is the
  // first; when it was finished, what drafted it, and what a reroll asked
  // it to change. `original` is the site's part as it was kept.
  list?: { at: number; by?: string; change?: string; original?: true }[];
  // Finished takes for these words the writer cancelled before, which can
  // be brought back instead of drafting again.
  earlier?: number;
  // Before anything is drafted: parts the writer already has that are near
  // the words, their own first, to look at in the preview and use instead.
  near?: { name: string; description: string; own: boolean }[];
  // On a line of the site's own part: its name, whose takes these are, and
  // how many other blocks on the site's pages use it.
  of?: string;
  uses?: { blocks: number; pages: number };
  // `of` is the catalog's part, which the site has no drawing of yet
  // (`catalog`), or the site's own drawing of it (`changed`).
  catalog?: true;
  changed?: true;
  // Words after ":" on that line, the change a reroll asks for, and the
  // column of the ":", where the line is cut once the reroll starts.
  change?: { words: string; colon: number };
  // The writer's default drafter, in a few words, for the menu.
  drafter?: string;
}

// What the editor puts in place of the `new:` line once the writer chose.
export interface DraftDone {
  replace?: string;
  // The block's closer, which goes when the part takes nothing inside.
  drop?: number;
  // A kept part's name and its settings with their values, for the editor
  // to say what the part can do now that it is one.
  part?: { name: string; settings: { name: string; values: string[] }[] };
  error?: string;
  version?: number;
  // A site's part removed: where its files went.
  removed?: string;
}

export interface Completion {
  label: string;
  detail: string;
  kind: "part" | "setting" | "value" | "file";
  // Replaces [start, end) on the line.
  start: number;
  end: number;
  newText: string;
  // What the editor matches the typed text against, when not newText.
  filterText?: string;
}

// A Markdown picture up to the cursor, with its address so far: ![alt](/ima
const PICTURE_BEFORE = /!\[[^\]]*\]\(\s*<?([^)\s>]*)$/;
const PICTURES = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g;
// A file's address alone on a line in a block, as a PDF, video or audio part
// takes it: /files/route.pdf. One with no extension is a page's.
const BARE_FILE = /^\s*(\/[^\s/][^\s]*\.[A-Za-z0-9]+)\s*$/;

// A block with nothing in it yet, and what its part starts with: the
// opening line, the closer, and the starter's lines.
export interface Starter {
  line: number;
  close: number;
  // The opening line as it was, so the editor never fills another block
  // that has moved into its place.
  opener: string;
  part: string;
  body: string[];
}

// A line placing one of the site's own parts, which the accept key can
// redraft, keep or remove; and how many takes it has on screen.
export interface OwnLine {
  line: number;
  opener: string;
  part: string;
  takes?: number;
  catalog?: true;
  changed?: true;
}

interface Doc {
  text: string;
  rel: string;
  page: PageKind;
  // The line the last edit was on, which is asked about only after a pause.
  editing?: number;
  // The pick the writer has moved to with the next-pick key, drawn in place
  // of the first until they accept it, change the line or stop looking.
  chosen?: { words: string; plain: string };
}

export interface Options {
  // The longest the writer pauses on a words line before it is sent to Jev.
  // Leaving the line, Esc, or the accept key with nothing shown sends it at
  // once (askNow). Once the server has seen enough of the writer's typing,
  // the pause is fitted to it: a quarter again the gap the writer leaves
  // between keys nine times in ten, never under minIdleMs.
  idleMs?: number;
  minIdleMs?: number;
  // Each edit to a words line, for `bun run play` to log, so the pause can
  // be tuned on real typing (scripts/pause.ts).
  onEdit?: (edit: { t: number; line: number; words: string; pause: number }) => void;
  // How long a ghost text request waits for an answer before giving up.
  waitMs?: number;
  // How long after the last change the page is drawn to content/, so a burst
  // of keystrokes is one write. Hugo and the browser add about 215 ms after
  // the write. This was 300 ms while a stale preview was blamed on drawing
  // too often; the real cause was Hugo's dev server answering a reload with
  // 304 when two builds fell in the same second, fixed by the site's no-store
  // header (testing/hugo.toml).
  drawMs?: number;
  // Asks the second pass; without one, words after a ":" are never asked.
  refiner?: Refiner;
  // The site was opened again, from hugo.toml or rubric.md's theme line: its
  // skin may bring other parts, which the editor needs to know about.
  onReload?: (site: Site) => void;
  // Drafts a new part: Claude Code in the server, the stub in tests.
  harness?: Harness;
  // A draft started or finished, for the editor to say so.
  onDraft?: (state: DraftState) => void;
  // A page's empty blocks and their parts' starters, whenever they change,
  // so the editor can show what the preview shows faded, and fill it in.
  onStarters?: (file: string, starters: Starter[], own: OwnLine[]) => void;
  // Which tool and model draft, recorded with each draft.
  // The drafter, the writer's default or the one chosen for a draft, in
  // full, for the record, and in a few words, for the menu ("sonnet, low").
  drafter?: (use?: Drafter) => { full: string; short: string };
  // How drafts are asked for, when each starts: with tools unless "fast",
  // one turn with the files in the reply.
  mode?: () => Mode;
  // What a request for a new part needs, asked of Jev beside its first
  // draft, for the record only.
  traits?: (words: string) => Promise<Record<string, number>>;
}

// Only shown, before the pick in the ghost text: accepting replaces the words.
const ARROW = " -> ";

export class Workspace {
  // Replaced by reload() when hugo.toml changes, as when the theme does.
  site: Site;
  #cache: Cache;
  #resolver: Resolver;
  #publish: (file: string, notes: Note[]) => void;
  #docs = new Map<string, Doc>();
  #written = new Map<string, string>();
  #inflight = new Map<string, Promise<void>>();
  #errors = new Map<string, string>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #draws = new Map<string, ReturnType<typeof setTimeout>>();
  #idleMs: number;
  #minIdleMs: number;
  #onEdit: Options["onEdit"];
  // The writer's recent gaps between keys on a words line, and the last edit.
  #gaps: number[] = [];
  #lastEdit: { file: string; line: number; t: number } | undefined;
  #waitMs: number;
  #drawMs: number;
  #refiner: Refiner | undefined;
  #onReload: Options["onReload"];
  #harness: Harness | undefined;
  #onDraft: Options["onDraft"];
  #onStarters: Options["onStarters"];
  #starters = new Map<string, string>();
  #drafter: Options["drafter"];
  #mode: Options["mode"];
  #traits: Options["traits"];
  // Every draft on disk, by id, and the runs in flight, by words.
  #drafts = new Map<string, DraftState>();
  #running = new Map<string, { id: string; stop: AbortController; started: Promise<void>; done: Promise<void> }>();
  // This server's list of open pages in .rubric/open/, for the others.
  #claim = `${process.pid}-${randomUUID().slice(0, 8)}.json`;

  constructor(site: Site, cache: Cache, resolver: Resolver, publish: (file: string, notes: Note[]) => void, opts: Options = {}) {
    this.site = site;
    this.#cache = cache;
    this.#resolver = resolver;
    this.#publish = publish;
    this.#idleMs = opts.idleMs ?? 600;
    this.#minIdleMs = Math.min(opts.minIdleMs ?? 300, this.#idleMs);
    this.#onEdit = opts.onEdit;
    this.#waitMs = opts.waitMs ?? 5000;
    this.#drawMs = opts.drawMs ?? 100;
    this.#refiner = opts.refiner;
    this.#onReload = opts.onReload;
    this.#harness = opts.harness;
    this.#onDraft = opts.onDraft;
    this.#onStarters = opts.onStarters;
    this.#drafter = opts.drafter;
    this.#mode = opts.mode;
    this.#traits = opts.traits;
    // A draft left half made by a server that stopped will never finish.
    for (const d of readDrafts(site.root)) {
      this.#drafts.set(d.id, d.status === "drafting" ? { ...d, status: "failed", message: "the editor closed while it was being drafted" } : d);
    }
  }

  // Writes content/ for every page on disk, from the cache only. Run once at
  // start, so the preview is whole before any page is opened.
  // A page open in another editor is that editor's server's to draw.
  async buildAll(): Promise<void> {
    // What's going is taken away once the pages are drawn without it.
    await writeHugoTree(this.site.root, this.site.own, false).catch(() => {});
    const elsewhere = await this.#openElsewhere();
    const mine = (file: string) => !this.#docs.has(file) && !elsewhere.has(file);
    const files = (await readdir(this.site.pages, { recursive: true })).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const file = join(this.site.pages, f);
      if (mine(file)) await this.#write(f, pageKind(f), await readFile(file, "utf8"));
    }
    const rubric = join(this.site.root, "rubric.md");
    if (mine(rubric)) await this.#write("rubric.md", "site", await readFile(rubric, "utf8").catch(() => ""));
  }

  // Each Neovim runs its own server, and each draws every page it doesn't
  // have open from disk: when it starts, and on every theme switch. Without
  // this, a page open with unsaved changes in one editor was drawn from disk
  // by another's server, and its preview lost them until the next keystroke.
  // So each server lists its open pages in .rubric/open/, and leaves the
  // pages another live server lists alone.
  get #claims(): string {
    return join(this.site.root, ".rubric/open");
  }

  #claimOpen(): Promise<void> {
    const list = JSON.stringify({ pid: process.pid, files: [...this.#docs.keys()] }) + "\n";
    return writeWhole(join(this.#claims, this.#claim), list, join(this.site.root, ".rubric/tmp")).catch(() => {});
  }

  async #openElsewhere(): Promise<Set<string>> {
    const open = new Set<string>();
    const names = await readdir(this.#claims).catch(() => [] as string[]);
    for (const name of names) {
      if (name === this.#claim || !name.endsWith(".json")) continue;
      const path = join(this.#claims, name);
      try {
        const { pid, files } = JSON.parse(await readFile(path, "utf8")) as { pid: number; files: string[] };
        if (alive(pid)) for (const f of files) open.add(f);
        else await unlink(path);
      } catch {}
    }
    return open;
  }

  // The server is stopping: its pages are no longer open anywhere, and its
  // drafts stop.
  dispose(): void {
    for (const r of this.#running.values()) r.stop.abort();
    try {
      unlinkSync(join(this.#claims, this.#claim));
    } catch {}
  }

  // The site again, after hugo.toml changed: a new theme may bring another
  // skin, so other parts and settings. Every page is drawn again with it, and
  // open pages' lines are asked about in it; answers are kept per skin, so
  // lines already asked in it cost nothing.
  async reload(site: Site): Promise<void> {
    this.site = site;
    this.#onReload?.(site);
    this.#errors.clear();
    this.#written.clear();
    await this.buildAll();
    for (const file of this.#docs.keys()) {
      await this.#render(file);
      this.#askAll(file);
    }
    await writeHugoTree(this.site.root, this.site.own).catch(() => {});
  }

  // Where the writer's cursor is, for the live preview to follow: the page's
  // file as Hugo knows it, its address, and the line. Nothing for rubric.md,
  // which is not a page of its own.
  cursor(file: string, line: number): { source: string; url: string; line: number } | undefined {
    const doc = this.#docs.get(file);
    if (!doc || doc.page === "site") return undefined;
    return { source: doc.rel, url: pageUrl(doc.rel, doc.text), line };
  }

  // The parts a line can be in this kind of file: the frame in rubric.md,
  // the parts for the writing in a page.
  #place(page: PageKind): Place {
    return page === "site" ? "site" : "writing";
  }

  #parts(page: PageKind): Catalog["parts"] {
    return atPlace(this.site.catalog, this.#place(page)).parts;
  }

  isPage(file: string): boolean {
    return pagePath(this.site, file) !== undefined;
  }

  async open(file: string, text: string): Promise<void> {
    const rel = pagePath(this.site, file);
    if (rel === undefined) return;
    this.#docs.set(file, { text, rel, page: pageKind(rel) });
    await this.#claimOpen();
    await this.#render(file);
    // Lines on disk are finished; ask about them now.
    this.#askAll(file);
  }

  async change(file: string, text: string): Promise<void> {
    const doc = this.#docs.get(file);
    if (!doc) return this.open(file, text);
    doc.editing = firstChangedLine(doc.text, text);
    doc.text = text;
    // Accepted or reworded: the line no longer holds the words it was for.
    if (doc.chosen && !scan(text, this.site.catalog).directives.some((d) => d.kind === "words" && d.words === doc.chosen!.words)) {
      doc.chosen = undefined;
    }
    this.#timeEdit(file, doc);
    this.#drawSoon(file);
    // Half-typed words are not worth an answer: the line being edited waits
    // for a pause, and every other line has been left, so is finished.
    this.#askAll(file, doc.editing);
    this.#schedule(file);
  }

  // The writer says the line is done (Esc, or the accept key before any ghost
  // text): ask now rather than after the pause. The ghost text request
  // Neovim already has open is answered as soon as Jev is.
  askNow(file: string): void {
    if (!this.#docs.has(file)) return;
    clearTimeout(this.#timers.get(file));
    this.#timers.delete(file);
    this.#askAll(file);
  }

  // The writer moved to another pick (index from 0), or stopped looking at
  // one (no index): the page shows what the ghost text shows. Never written
  // to the cache or the file; only accepting does that.
  choose(file: string, line: number, index?: number): void {
    const doc = this.#docs.get(file);
    if (!doc) return;
    const d = this.#directiveAt(doc, line);
    const hit = d?.kind === "words" && d.words !== undefined ? this.#cache.get(this.site.catalog, doc.page, d.words) : undefined;
    const pick = index === undefined ? undefined : hit?.candidates[index];
    if (!pick && !doc.chosen) return;
    if (pick) doc.chosen = { words: d!.words!, plain: pick.plain };
    else doc.chosen = undefined;
    this.#drawSoon(file);
  }

  // How long to wait for a pause on the line being typed: fitted to the
  // writer once there are enough gaps to go on, the most otherwise.
  pause(): number {
    if (this.#gaps.length < 20) return this.#idleMs;
    const sorted = [...this.#gaps].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))]!;
    return Math.round(Math.min(this.#idleMs, Math.max(this.#minIdleMs, 1.25 * p90)));
  }

  #timeEdit(file: string, doc: Doc): void {
    const line = doc.editing;
    const d = line === undefined ? undefined : this.#directiveAt(doc, line);
    if (line === undefined || d?.kind !== "words" || d.line !== line || d.words === undefined) {
      this.#lastEdit = undefined;
      return;
    }
    const t = Date.now();
    const last = this.#lastEdit;
    // Only gaps within one burst of typing on one line: a longer one is the
    // writer stopping, which is what the pause is for.
    if (last && last.file === file && last.line === line && t - last.t < 2000) {
      this.#gaps.push(t - last.t);
      if (this.#gaps.length > 200) this.#gaps.shift();
    }
    this.#lastEdit = { file, line, t };
    this.#onEdit?.({ t, line, words: d.words, pause: this.pause() });
  }

  // A closed page is drawn from disk again, so unsaved edits leave the preview.
  async close(file: string): Promise<void> {
    const doc = this.#docs.get(file);
    if (!doc) return;
    this.#docs.delete(file);
    // Opened again, its starters are sent again.
    this.#starters.delete(file);
    await this.#claimOpen();
    clearTimeout(this.#timers.get(file));
    this.#timers.delete(file);
    clearTimeout(this.#draws.get(file));
    this.#draws.delete(file);
    try {
      await this.#write(doc.rel, doc.page, await readFile(file, "utf8"));
    } catch {}
    this.#publish(file, []);
  }

  // Asks, waits for every answer in flight, and draws every pending page.
  // For tests and shutdown.
  async settle(): Promise<void> {
    for (const t of this.#timers.values()) clearTimeout(t);
    for (const file of this.#timers.keys()) this.#askAll(file);
    this.#timers.clear();
    while (this.#inflight.size > 0 || this.#draws.size > 0) {
      await Promise.all(this.#inflight.values());
      for (const [file, t] of this.#draws) {
        clearTimeout(t);
        this.#draws.delete(file);
        await this.#render(file);
      }
    }
  }

  // Ghost text for a words line: the plain form each candidate would pin,
  // best first. The answer comes once the writer pauses or leaves the line,
  // so this waits for it, but gives up if the line changes first: a pick for
  // words that are no longer there would be pinned onto the wrong ones.
  async ghost(file: string, line: number): Promise<Ghost[]> {
    const ghosts = await this.#ghost(file, line);
    // Neovim goes back to the first pick with every answer, so the page does.
    const doc = this.#docs.get(file);
    if (doc?.chosen) {
      doc.chosen = undefined;
      this.#drawSoon(file);
    }
    return ghosts;
  }

  async #ghost(file: string, line: number): Promise<Ghost[]> {
    const doc = this.#docs.get(file);
    const at = doc && this.#directiveAt(doc, line);
    // On a site's own part, words after ":" are a reroll's change, from its menu.
    if (doc && at?.plain && at.refine) return this.#ownOnly(at.plain.part) ? [] : this.#refineGhost(file, line);
    const words = () => {
      const d = this.#docs.get(file) && this.#directiveAt(this.#docs.get(file)!, line);
      return d?.kind === "words" ? d.words : undefined;
    };
    const asked = words();
    if (!doc || asked === undefined) return [];

    const key = this.#key(doc.page, asked);
    const lookup = () => this.#cache.get(this.site.catalog, doc.page, asked);
    let hit = lookup();
    for (const end = Date.now() + this.#waitMs; !hit && Date.now() < end; hit = lookup()) {
      if (words() !== asked || (this.#errors.has(key) && !this.#inflight.has(key))) return [];
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!hit || words() !== asked) return [];

    const lineText = splitLines(doc.text)[line] ?? "";
    const end = lineText.length;
    const sep = lineText.endsWith(" ") ? ARROW.trimStart() : ARROW;
    const lead = opener(lineText);
    // Nothing in the catalog fits: offer to draft a part for the words. Only
    // in a page, and only with a harness to draft it.
    if (hit.outcome === "nothing-fits") {
      if (doc.page === "site" || !this.#harness || !this.site.ownMounted) return [];
      return [{ text: `${sep}draft a new part`, line, character: end, replace: `${lead} new: ${asked}`, build: true }];
    }
    // An empty block gets the part's starter body with the pin, so the writer
    // sees what the part expects; a block with anything in it gets nothing.
    const d = this.#directiveAt(doc, line);
    const empty = d?.close !== undefined && splitLines(doc.text).slice(line + 1, d.close).every((l) => l.trim() === "");
    return hit.candidates.map((c) => {
      const part = this.site.catalog.parts[c.part];
      const body = empty ? part?.body?.replace(/\n+$/, "") : undefined;
      // Anything written inside stays, as writing after the part, as the
      // preview drew it before accepting.
      const drop = part?.empty && d?.close !== undefined ? { drop: d.close } : {};
      return { text: `${sep}${c.plain}${body ? `\n${body}` : ""}`, line, character: end, replace: `${lead} ${c.plain}`, ...drop };
    });
  }

  // Ghost text for words after a pin's ":": the settings they would change,
  // shown at the end of the line. Accepting rewrites the pin and drops the
  // words, and any before an arrow: the pin then says all they asked.
  // Nothing when the pin already says what the words ask.
  async #refineGhost(file: string, line: number): Promise<Ghost[]> {
    const current = () => {
      const doc = this.#docs.get(file);
      const d = doc && this.#directiveAt(doc, line);
      return doc && d?.plain && d.refine && d.problems.length === 0 ? { doc, d, plain: d.plain, refine: d.refine } : undefined;
    };
    const first = current();
    if (!first || refineWords(first.refine.words) === "") return [];
    const part = first.plain.part;
    const words = refineWords(first.refine.words);
    const key = this.#rkey(part, words);
    const same = () => {
      const c = current();
      return c !== undefined && c.plain.part === part && refineWords(c.refine.words) === words;
    };
    const lookup = () => this.#cache.getRefine(this.site.catalog, part, words);
    let hit = lookup();
    for (const end = Date.now() + this.#waitMs; !hit && Date.now() < end; hit = lookup()) {
      if (!same() || (this.#errors.has(key) && !this.#inflight.has(key))) return [];
      await new Promise((r) => setTimeout(r, 25));
    }
    const now = current();
    if (!hit || !now || !same()) return [];

    const next = applyRefine(now.plain, hit, this.site.catalog);
    const before = formatPlain(now.plain);
    const after = formatPlain(next);
    if (after === before) return [];
    const lineText = splitLines(now.doc.text)[line] ?? "";
    const was = new Map(now.plain.settings.map((s) => [s.key, s.value]));
    const changes = [
      ...next.settings.filter((s) => was.get(s.key) !== s.value).map((s) => `${s.key}=${s.value}`),
      ...now.plain.settings.filter((s) => !next.settings.some((n) => n.key === s.key)).map((s) => `${s.key} back to default`),
    ];
    const sep = lineText.endsWith(" ") ? "" : " ";
    return [{
      text: `${sep}⇒ ${changes.join(" ")}`,
      line,
      character: lineText.length,
      replace: `${opener(lineText)} ${after}`,
    }];
  }

  // ── New parts (docs/plan.md, step 7) ─────────────────────────────────

  // The drafts for a line, newest first, by its key: a `new:` line's words,
  // or ownKey() of the site's part a line redrafts.
  #draftsFor(key: string): DraftState[] {
    return [...this.#drafts.values()].filter((d) => draftKey(d) === key).sort((a, b) => b.started - a.started);
  }

  // The finished draft the preview draws for a line: the take on screen.
  #shown(key: string): DraftState | undefined {
    return shownTake(this.#drafts.values(), key);
  }

  #takes(key: string): { take?: number; takes?: number } {
    const takes = takesFor(this.#drafts.values(), key);
    const shown = this.#shown(key);
    return shown ? { take: takes.indexOf(shown) + 1, takes: takes.length } : {};
  }

  // The takes to choose between, for the editor's list.
  #takeList(key: string): Pick<DraftView, "list"> {
    const takes = takesFor(this.#drafts.values(), key);
    if (takes.length < 2) return {};
    return {
      list: takes.map((d) => ({
        // When it was started, which is what they are ordered by.
        at: d.started,
        ...(d.drafter ? { by: `${shortDrafter({ ...d.drafter, harness: d.drafter.harness as HarnessName })}${d.mode === "tools" ? ", tools" : ""}` } : {}),
        ...(d.change ? { change: d.change } : {}),
        ...(d.original ? { original: true as const } : {}),
      })),
    };
  }

  // Finished takes for these words whose last word in the record is that
  // they were cancelled, and whose folder is still there.
  #earlier(words: string): string[] {
    const index = this.#index();
    return [...index.entries()].filter(([id, e]) =>
      e.of === undefined && e.words === words && e.status === "ready" && e.outcome === "cancelled" && !this.#drafts.has(id) && existsSync(join(this.site.root, DRAFT_LOGS, id, "part.yaml")),
    ).map(([id]) => id);
  }

  // Each draft's last line in the record, read again only when it changed.
  #indexCache: { mtime: number; entries: Map<string, { words?: string; status?: string; outcome?: string; of?: string }> } | undefined;
  #index(): Map<string, { words?: string; status?: string; outcome?: string; of?: string }> {
    const file = join(this.site.root, DRAFT_INDEX);
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      return new Map();
    }
    if (this.#indexCache?.mtime === mtime) return this.#indexCache.entries;
    const entries = new Map<string, { words?: string; status?: string; outcome?: string; of?: string }>();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      try {
        const e = JSON.parse(line) as { id?: string; words?: string; status?: string; outcome?: string; of?: string };
        if (e.id) entries.set(e.id, e);
      } catch {}
    }
    this.#indexCache = { mtime, entries };
    return entries;
  }

  #newLine(file: string, line: number): { doc: Doc; d: Directive } | undefined {
    const doc = this.#docs.get(file);
    const d = doc && this.#directiveAt(doc, line);
    return doc && d?.kind === "new" && d.words !== undefined ? { doc, d } : undefined;
  }

  // A line drafts are for: a `new:` line, by its words, or a line placing
  // one of the site's own parts, whose takes keep its name.
  #draftLine(file: string, line: number): { doc: Doc; d: Directive; key: string; words: string; of?: string } | undefined {
    const at = this.#newLine(file, line);
    if (at) return { ...at, key: at.d.words!, words: at.d.words! };
    const doc = this.#docs.get(file);
    const d = doc && this.#directiveAt(doc, line);
    const of = doc && d && this.#ownPart(doc, d);
    return of ? { doc: doc!, d: d!, key: ownKey(of), words: this.site.catalog.parts[of]!.description, of } : undefined;
  }

  // The part a line places in its plain form, if the site has its own
  // drawing of it or can have one: the site's own parts, and the catalog's
  // parts in the writing. By its name alone: a take on screen may lack a
  // setting the line sets, and the line must stay the part's, to keep, cycle
  // or go back.
  #ownPart(doc: Doc, d: Directive): string | undefined {
    const name = d.plain?.part;
    return doc.page !== "site" && name && (this.#isOwn(name) || changeable(this.site.shared, name, this.site.themeDir)) ? name : undefined;
  }

  #isOwn(name: string): boolean {
    return Object.hasOwn(this.site.catalog.parts, name) && this.site.catalog.parts[name]!.origin === "site";
  }

  // A part of the site's own, not its drawing of a catalog part: Jev knows
  // nothing of it, so words after its ":" are a reroll's change.
  #ownOnly(name: string): boolean {
    return this.#isOwn(name) && !this.site.catalog.parts[name]!.changed;
  }

  // Whether `name` is the catalog's part, as the site draws it or not.
  #shared(name: string): boolean {
    return Object.hasOwn(this.site.shared.parts, name);
  }

  // How many blocks on the site's pages place `name`, besides the one at
  // `line` of `file`: open pages as the editor holds them, the rest from disk.
  async #uses(name: string, file: string, line: number): Promise<{ blocks: number; pages: number }> {
    let blocks = 0;
    let pages = 0;
    const files = (await readdir(this.site.pages, { recursive: true }).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).map((f) => join(this.site.pages, f));
    for (const f of files) {
      const text = this.#docs.get(f)?.text ?? (await readFile(f, "utf8").catch(() => ""));
      const n = scan(text, this.site.catalog).directives.filter((d) => d.plain?.part === name && !(f === file && d.line === line)).length;
      blocks += n;
      if (n > 0) pages++;
    }
    return { blocks, pages };
  }

  // The site's part as it is kept, as the first of its takes, so the writer
  // can go back to it from the others; the catalog's, when the site has no
  // drawing of its own.
  async #original(name: string, words: string): Promise<void> {
    if (takesFor(this.#drafts.values(), ownKey(name)).length > 0) return;
    const { dir, state } = await newDraft(this.site.root, words, undefined, name);
    if (existsSync(join(this.site.root, "parts", name))) {
      for (const f of ["part.yaml", "part.html", "part.css"]) {
        const from = join(this.site.root, "parts", name, f);
        if (existsSync(from)) await copyFile(from, join(dir, f));
      }
    } else {
      // As the site shows it: the skin's own drawing, when it has one.
      const files = catalogFiles(this.site.themeDir, name, this.site.skin);
      if (!files) throw new Error(`the catalog has no ${name}`);
      for (const [f, text] of [["part.yaml", files.yaml], ["part.html", files.html], ["part.css", files.css]] as const) await writeFile(join(dir, f), text + "\n");
    }
    const at = state.started - 1;
    const kept: DraftState = { ...state, status: "ready", name, original: true, started: at, finished: at };
    await saveState(this.site.root)(kept);
    this.#drafts.set(kept.id, kept);
  }

  // What the `new:` line at `line` has: no draft yet, one being made, one to
  // look at, one that failed, or a part the catalog has already.
  draft(file: string, line: number): DraftView | undefined {
    const at = this.#draftLine(file, line);
    if (!at) return undefined;
    const { words, key } = at;
    const latest = this.#draftsFor(key)[0];
    const shown = this.#shown(key);
    return {
      words,
      ...(at.of !== undefined ? { of: at.of } : {}),
      ...(at.of !== undefined && this.#shared(at.of) ? (existsSync(join(this.site.root, "parts", at.of)) ? { changed: true as const } : { catalog: true as const }) : {}),
      ...(this.#drafter ? { drafter: this.#drafter().short } : {}),
      ...(at.of !== undefined && at.d.refine && refineWords(at.d.refine.words) !== "" ? { change: { words: refineWords(at.d.refine.words), colon: at.d.refine.colon } } : {}),
      // A ready line names the take on screen, which is the one Keep keeps.
      ...(latest ? { status: latest.status, ...((latest.status === "ready" ? shown?.name : latest.name) ? { name: latest.status === "ready" ? shown!.name : latest.name } : {}), ...(latest.message ? { message: latest.message } : {}) } : {}),
      ...(shown?.name && shown !== latest && latest?.status !== "ready" ? { shown: shown.name } : {}),
      ...(latest ? { log: join(this.site.root, DRAFTS, latest.id, LOG) } : {}),
      ...this.#takes(key),
      ...this.#takeList(key),
      ...(latest || at.of !== undefined ? {} : (() => {
        const earlier = this.#earlier(words).length;
        return earlier ? { earlier } : {};
      })()),
      ...(latest || at.of !== undefined ? {} : (() => {
        const near = this.#near(at.doc.page, words);
        return near.length ? { near } : {};
      })()),
    };
  }

  // Parts the writer already has that Jev's answer for the words puts near
  // them: the ones drafted from words first (the site's own, and those kept
  // for every theme), then the catalog's, each in Jev's order.
  // From the answer already cached for the line; nothing is asked here.
  // Read from the Choice alone, whatever the outcome: "nothing fits" is
  // when a draft is offered, and it is often a part that is close but not
  // it (snow behind a heading, with a rain window kept: the Choice gave it
  // 0.99 and its fit 0.18).
  #near(page: PageKind, words: string): NonNullable<DraftView["near"]> {
    const hit = words ? this.#cache.get(this.site.catalog, page, words) : undefined;
    if (!hit) return [];
    const parts = this.site.catalog.parts;
    const near = Object.entries(hit.parts)
      .filter(([name, p]) => p >= THRESHOLDS.near && Object.hasOwn(parts, name) && parts[name]!.origin !== "draft")
      .sort((a, b) => b[1] - a[1])
      .slice(0, THRESHOLDS.nearMost)
      .map(([name]) => ({ name, description: parts[name]!.description, own: (parts[name]!.origin === "site" && !parts[name]!.changed) || parts[name]!.drafted === true }));
    return [...near.filter((n) => n.own), ...near.filter((n) => !n.own)];
  }

  // The part the writer is looking at for a `new:` line, from the list of
  // near ones: the preview draws it where the line is. No part: back to the
  // line as it was.
  #peek: { words: string; part: string } | undefined;
  peek(file: string, line: number, part?: string): void {
    const at = this.#newLine(file, line);
    const next = at && part && Object.hasOwn(this.site.catalog.parts, part) ? { words: at.d.words!, part } : undefined;
    if (this.#peek?.words === next?.words && this.#peek?.part === next?.part) return;
    this.#peek = next;
    for (const f of this.#docs.keys()) this.#drawSoon(f);
  }

  // draft(), and for a line of the site's own part, how many other blocks
  // on the site use it, which removing it would leave unknown.
  // A `new:` line with nothing drafted is asked of Jev here, when the writer
  // opens its menu, and not as it is typed: the answer is only the parts
  // near its words, to look at before drafting. Words typed before `new:`
  // were asked already, and cost nothing. The menu waits for the answer only
  // so long; without it, it opens with no such parts.
  async look(file: string, line: number): Promise<DraftView | undefined> {
    const at = this.#newLine(file, line);
    if (at && at.doc.page !== "site" && at.d.words && !this.#draftsFor(at.d.words)[0] && !this.#cache.get(this.site.catalog, at.doc.page, at.d.words)) {
      await Promise.race([this.#ask(at.doc.page, at.d.words), new Promise((r) => setTimeout(r, NEAR_WAIT_MS))]);
    }
    const view = this.draft(file, line);
    return view?.of !== undefined && !view.catalog && !view.changed ? { ...view, uses: await this.#uses(view.of, file, line) } : view;
  }

  // Moves the preview to the next take (step 1) or the one before (-1),
  // round; or to take `to`, counted from 1, oldest first.
  async take(file: string, line: number, step: number, to?: number): Promise<DraftView | undefined> {
    const at = this.#draftLine(file, line);
    if (!at) return undefined;
    const takes = takesFor(this.#drafts.values(), at.key);
    const shown = this.#shown(at.key);
    if (takes.length < 2 || !shown) return this.draft(file, line);
    const next = to !== undefined ? takes[to - 1] : takes[(takes.indexOf(shown) + step + takes.length * 10) % takes.length]!;
    if (!next) return this.draft(file, line);
    if (next === shown) return this.draft(file, line);
    // Later than the take on screen, even within one millisecond, so two
    // moves in a row always end on the second.
    const chosen: DraftState = { ...next, chosen: Math.max(Date.now(), Math.max(shown.chosen ?? 0, shown.finished ?? shown.started) + 1) };
    this.#drafts.set(chosen.id, chosen);
    await saveState(this.site.root)(chosen);
    await this.#reopen();
    for (const f of this.#docs.keys()) this.#drawSoon(f);
    return this.draft(file, line);
  }

  // The takes cancelled before for these words, back on the line.
  async restore(file: string, line: number): Promise<DraftView | undefined> {
    const at = this.#newLine(file, line);
    if (!at) return undefined;
    await mkdir(join(this.site.root, DRAFTS), { recursive: true });
    for (const id of this.#earlier(at.d.words!)) {
      const from = join(this.site.root, DRAFT_LOGS, id);
      const to = join(this.site.root, DRAFTS, id);
      let state: DraftState;
      try {
        state = JSON.parse(await readFile(join(from, "state.json"), "utf8")) as DraftState;
        await rename(from, to);
      } catch {
        continue;
      }
      this.#drafts.set(id, state);
      await appendFile(join(this.site.root, DRAFT_INDEX), JSON.stringify({ id, words: state.words, status: state.status, name: state.name, outcome: "brought back" }) + "\n").catch(() => {});
    }
    await this.#reopen();
    for (const f of this.#docs.keys()) this.#drawSoon(f);
    return this.draft(file, line);
  }

  // Starts a draft for the `new:` line at `line`. A reroll passes what to
  // change ("" for another take); the draft shown stays until the new one is
  // ready.
  // `drafter` drafts this one alone, in place of the writer's default.
  async build(file: string, line: number, opts: { change?: string; drafter?: Drafter } = {}): Promise<DraftView | undefined> {
    const at = this.#draftLine(file, line);
    if (!at || !this.#harness) return this.draft(file, line);
    const { words, key, of } = at;
    const runKey = key;
    if (words.trim() === "") return this.draft(file, line);
    // One already starting or running: say where it is, once it has started.
    // One being stopped is waited out, and then this one starts: asked for
    // again before the tool has gone, the draft would otherwise never start.
    for (let already = this.#running.get(runKey); already; already = this.#running.get(runKey)) {
      await already.started;
      if (!already.stop.signal.aborted) return this.draft(file, line);
      await already.done.catch(() => {});
      if (this.#running.get(runKey) === already) this.#running.delete(runKey);
    }
    // Taken at once, before anything is awaited, so a second request for the
    // same words while this one starts finds it.
    const stop = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    const run = { id: "", stop, started: ready, done: ready as Promise<void> };
    this.#running.set(runKey, run);
    const src = splitLines(at.doc.text);
    const inside = at.d.close === undefined ? "" : src.slice(at.d.line + 1, at.d.close).join("\n");
    let made: Awaited<ReturnType<typeof newDraft>>;
    let previous: DraftState | undefined;
    try {
      // Another take of a site's part starts from the take on screen, the
      // part as kept at first.
      if (of !== undefined) await this.#original(of, words);
      previous = opts.change !== undefined || of !== undefined ? this.#shown(key) : undefined;
      made = await newDraft(this.site.root, words, this.#drafter?.(opts.drafter).full, of);
    } catch (err) {
      this.#running.delete(runKey);
      started();
      throw err;
    }
    const { dir, state } = made;
    run.id = state.id;
    const save = saveState(this.site.root);
    await save(state);
    this.#drafts.set(state.id, state);
    this.#onDraft?.(state);
    const site = this.site;
    const mode = this.#mode?.() ?? "tools";
    // A fast draft never stops to ask whether the catalog has the part; the
    // small model is asked beside it, for the line's note to say so if it
    // does. Words typed before `new:` were asked already.
    if (mode === "fast" && of === undefined && !this.#cache.get(site.catalog, at.doc.page, words)) void this.#ask(at.doc.page, words);
    // What the words ask for, for the record: asked once, beside the first
    // draft, and carried by its takes. The draft never waits on it.
    const carried = (previous ?? this.#shown(key))?.traits;
    const traits: Promise<Record<string, number> | undefined> = carried ? Promise.resolve(carried)
      : of === undefined && this.#traits ? this.#traits(words).catch(() => undefined) : Promise.resolve(undefined);
    run.done = (async () => {
      let end: DraftState;
      try {
        end = await runDraft(site, dir, state, {
          words, inside,
          ...(previous ? { previous: { dir: join(this.site.root, DRAFTS, previous.id), change: opts.change ?? "" } } : {}),
          ...(of !== undefined ? { of } : {}),
          ...(previous?.session ? { resume: previous.session } : {}),
          ...(opts.drafter ? { use: opts.drafter } : {}),
          mode,
        }, this.#harness!, stop.signal, save);
      } catch (err) {
        end = { ...state, status: "failed", message: (err as Error).message, finished: Date.now() };
        await save(end).catch(() => {});
      }
      if (this.#running.get(runKey) === run) this.#running.delete(runKey);
      // Stopped: cancel took it away already.
      if (!this.#drafts.has(state.id)) return;
      this.#drafts.set(state.id, end);
      // A new take joins the ones before it and goes on screen; drafts that
      // failed go to the record.
      if (end.status === "ready") {
        for (const old of this.#draftsFor(key)) if (old.id !== end.id && old.status === "failed") await this.#forget(old.id, "replaced");
      }
      await this.#reopen();
      this.#onDraft?.(end);
      // After the draft is on screen, and only while it is still this
      // take: an answer that is late by then is left out.
      const asked = await Promise.race([traits, new Promise<undefined>((r) => setTimeout(() => r(undefined), TRAITS_WAIT_MS))]);
      if (asked && this.#drafts.get(state.id) === end) {
        const kept = { ...end, traits: asked };
        this.#drafts.set(state.id, kept);
        await save(kept).catch(() => {});
      }
    })();
    started();
    for (const f of this.#docs.keys()) this.#drawSoon(f);
    return this.draft(file, line);
  }

  // The writer keeps the draft shown for the line: the site's own part, or,
  // with `global`, the catalog's, for every theme. The line becomes the part.
  async keep(file: string, line: number, global: boolean): Promise<DraftDone> {
    const own = this.#draftLine(file, line);
    if (own?.of !== undefined) return this.#keepOwn(own.key, own.of, global);
    const at = this.#newLine(file, line);
    const shown = at && this.#shown(at.d.words!);
    if (!at || !shown?.name) return { error: "there is no draft to keep on this line" };
    const dir = join(this.site.root, DRAFTS, shown.id);
    const lead = opener(splitLines(at.doc.text)[line] ?? "");
    let version: number | undefined;
    try {
      if (global) version = await makeGlobal(this.site.themeDir, dir, shown.name);
      else await keepLocal(this.site.root, dir, shown.name);
    } catch (err) {
      return { error: (err as Error).message };
    }
    await this.#stop(at.d.words!, "dropped");
    for (const d of this.#draftsFor(at.d.words!)) await this.#forget(d.id, d.id === shown.id ? (global ? "kept for every theme" : "kept for the site") : "another take was kept");
    await this.#reopen();
    return {
      replace: `${lead} ${shown.name}`, ...this.#drop(at.d, shown.name), ...(version === undefined ? {} : { version }),
      part: this.#kept(shown.name),
    };
  }

  // A kept part's name and settings, for the editor to say what it can do.
  #kept(name: string): NonNullable<DraftDone["part"]> {
    const settings = Object.entries(this.site.catalog.parts[name]?.settings ?? {}).map(([name, def]) => ({
      name,
      values: def.type === "choice" ? Object.keys(def.values) : def.type === "level" ? Object.keys(def.levels) : def.type === "flag" ? ["true", "false"] : [],
    }));
    return { name, settings };
  }

  // Keeps the take of a site's part on screen, under the same name, so every
  // page with it changes; or, with `global`, puts it in the catalog for every
  // theme, and the site's copy goes to the record. The line stays.
  async #keepOwn(key: string, of: string, global: boolean): Promise<DraftDone> {
    const shown = this.#shown(key);
    const dir = shown ? join(this.site.root, DRAFTS, shown.id) : join(this.site.root, "parts", of);
    let version: number | undefined;
    // The site's drawing of a catalog part is for this site: the catalog
    // already has the part.
    const shared = this.#shared(of);
    if (global && shared) return { error: `${of} is the catalog's already; this drawing is for this site` };
    try {
      if (global) {
        version = await makeGlobal(this.site.themeDir, dir, of);
        await putAway(this.site.root, of).catch((err: Error) => {
          throw new Error(`${of} is in the catalog now, version ${version}, but parts/${of} could not be moved out of the site, so both have it; move it yourself: ${err.message}`);
        });
      } else if (shown && !shown.original) await keepTake(this.site.root, dir, of, shared);
    } catch (err) {
      return { error: (err as Error).message };
    }
    await this.#stop(key, "dropped");
    for (const d of this.#draftsFor(key)) {
      await this.#forget(d.id, d.id !== shown?.id ? "another take was kept" : global ? "kept for every theme" : d.original ? "kept as it was" : "kept for the site");
    }
    await this.#reopen();
    return { ...(version === undefined ? {} : { version }), part: this.#kept(of) };
  }

  // Takes a site's own part away: its takes go, and its files go to the
  // record (.rubric/logs/removed/), not deleted. The lines using it stay,
  // and say the part is unknown.
  async remove(file: string, line: number): Promise<DraftDone> {
    const at = this.#draftLine(file, line);
    if (at?.of === undefined || (this.#shared(at.of) && !existsSync(join(this.site.root, "parts", at.of)))) return { error: "this line is not one of the site's own parts" };
    await this.#stop(at.key, "the part was removed");
    let removed: string;
    try {
      removed = await putAway(this.site.root, at.of);
    } catch (err) {
      return { error: (err as Error).message };
    }
    for (const d of this.#draftsFor(at.key)) await this.#forget(d.id, "the part was removed");
    await this.#reopen();
    return { removed };
  }

  // The writer doesn't want a new part: every draft for the line goes, and
  // the line goes back to words.
  async cancel(file: string, line: number): Promise<DraftDone> {
    const own = this.#draftLine(file, line);
    // Another take of a site's part: back to the part as it was kept.
    if (own?.of !== undefined) {
      await this.#stop(own.key, "cancelled");
      for (const d of this.#draftsFor(own.key)) await this.#forget(d.id, d.original ? "kept as it was" : "cancelled");
      await this.#reopen();
      for (const f of this.#docs.keys()) this.#drawSoon(f);
      return {};
    }
    const at = this.#newLine(file, line);
    if (!at) return { error: "this is not a new: line" };
    const words = at.d.words!;
    await this.#stop(words, "cancelled");
    for (const d of this.#draftsFor(words)) await this.#forget(d.id, "cancelled");
    await this.#reopen();
    return { replace: `${opener(splitLines(at.doc.text)[line] ?? "")} ${words}` };
  }

  // Taking too long: only the draft being made stops. A draft already made
  // for the line stays, to keep or reroll, and the line stays as it is.
  async stop(file: string, line: number): Promise<DraftDone> {
    const at = this.#draftLine(file, line);
    if (!at) return { error: "this line has no draft" };
    await this.#stop(at.key, "stopped");
    // A site's part with no other take than itself is just the part again.
    const left = this.#draftsFor(at.key);
    if (at.of !== undefined && left.every((d) => d.original)) for (const d of left) await this.#forget(d.id, "kept as it was");
    await this.#reopen();
    for (const f of this.#docs.keys()) this.#drawSoon(f);
    return {};
  }

  // One of the catalog's parts near the words, chosen by the writer from
  // the list, in place of the line.
  async use(file: string, line: number, part: string): Promise<DraftDone> {
    const at = this.#newLine(file, line);
    if (!at) return { error: "no new part is asked for on this line" };
    // The list is closed either way: the preview stops drawing its part.
    this.peek(file, line);
    if (!this.#near(at.doc.page, at.d.words!).some((n) => n.name === part)) return { error: `${part} is not one of the parts near this line` };
    return { replace: `${opener(splitLines(at.doc.text)[line] ?? "")} ${part}`, ...this.#drop(at.d, part) };
  }

  // A part that takes nothing inside has no block, so the `new:` line's closer goes.
  #drop(d: Directive, part: string): { drop?: number } {
    return this.site.catalog.parts[part]?.empty && d.close !== undefined ? { drop: d.close } : {};
  }

  // Waits for every draft in flight. For tests.
  async drafted(): Promise<void> {
    while (this.#running.size > 0) await Promise.all([...this.#running.values()].map((r) => r.done));
    await this.settle();
  }

  async #stop(key: string, outcome: string): Promise<void> {
    const run = this.#running.get(key);
    if (!run) return;
    run.stop.abort();
    // A run still starting has no id yet; its work starts once it has one.
    for (let waited: Promise<void> | undefined; waited !== run.done; ) {
      waited = run.done;
      this.#drafts.delete(run.id);
      await waited.catch(() => {});
    }
    if (this.#running.get(key) === run) this.#running.delete(key);
    await this.#forget(run.id, outcome);
  }

  // The writer is done with a draft: it leaves the drafts, and goes, whole,
  // to the drafts' log with what became of it, and a line in the index.
  async #forget(id: string, outcome: string): Promise<void> {
    this.#drafts.delete(id);
    if (!id) return;
    const root = this.site.root;
    const from = join(root, DRAFTS, id);
    const state = await readFile(join(from, "state.json"), "utf8").then((t) => JSON.parse(t) as DraftState).catch(() => undefined);
    try {
      await mkdir(join(root, DRAFT_LOGS), { recursive: true });
      // Brought back once and cancelled again: the newer copy replaces it.
      await rm(join(root, DRAFT_LOGS, id), { recursive: true, force: true });
      await rename(from, join(root, DRAFT_LOGS, id));
    } catch {
      await rm(from, { recursive: true, force: true });
    }
    if (!state) return;
    const line = {
      id, words: state.words, ...(state.of !== undefined ? { of: state.of } : {}), by: state.by, status: state.status, name: state.name, message: state.message, outcome,
      started: new Date(state.started).toISOString(),
      seconds: state.finished ? Math.round((state.finished - state.started) / 1000) : undefined,
      // What it took, to study the tools and the brief by.
      kind: state.kind, change: state.change, traits: state.traits, mode: state.mode, drafter: state.drafter, brief: state.brief, runs: state.runs,
      // Passed the checks the first time they ran; nothing when they never did.
      firstTry: state.refused === undefined ? undefined : state.refused === 0,
      resumed: state.resumed, ...state.stats,
    };
    await appendFile(join(root, DRAFT_INDEX), JSON.stringify(line) + "\n").catch(() => {});
  }

  // The site again, with its own parts and drafts as they are now on disk.
  async #reopen(): Promise<void> {
    try {
      await this.reload(await openSite(this.site.root, this.lineTheme));
    } catch {}
  }

  // A note on each `new:` line saying where its draft is.
  #newNotes(doc: Doc): Note[] {
    if (doc.page === "site") return [];
    const src = splitLines(doc.text);
    const notes: Note[] = [];
    for (const d of scan(doc.text, this.site.catalog).directives) {
      if (d.kind !== "new") continue;
      const at = { line: d.line, start: 0, end: src[d.line]!.length };
      const words = d.words ?? "";
      const newest = this.#draftsFor(words)[0];
      const shown = this.#shown(words);
      // A ready line is about the take on screen, which is the one Keep keeps.
      const latest = newest?.status === "ready" && shown ? shown : newest;
      const showing = shown?.name ? `; ${shown.name} in the preview meanwhile` : "";
      // The block's last line, for the editor to mark the whole block.
      const close = d.close === undefined ? {} : { close: d.close };
      // What a ready draft can be set to, to judge it by before keeping it.
      const settings = latest?.status === "ready" && latest.name ? this.#kept(latest.name).settings : [];
      const sets = settings.length ? `. Settings: ${settings.map((t) => (t.values.length ? `${t.name}=${t.values.join("|")}` : `${t.name}=`)).join(" ")}` : "";
      const data = latest
        ? { data: { status: latest.status, ...(latest.name ? { name: latest.name } : {}), ...(latest.by ? { by: latest.by } : {}), started: latest.started, ...(shown?.name && shown !== latest ? { shown: shown.name } : {}), ...this.#takes(words), ...close, ...(settings.length ? { settings } : {}) } }
        : { data: { status: "none", ...close, ...(() => {
          const earlier = words ? this.#earlier(words).length : 0;
          return earlier ? { earlier } : {};
        })() } };
      const here = { ...at, ...data };
      // The catalog's part the small model would place for the words, said
      // beside the draft and never in its way: it is sometimes too eager.
      const hit = words ? this.#cache.get(this.site.catalog, doc.page, words) : undefined;
      const part = hit?.outcome === "placed" ? hit.candidates[0]?.part : undefined;
      const near = part && this.site.catalog.parts[part] && this.site.catalog.parts[part]!.origin !== "draft" && part !== latest?.name
        ? `. Similar in the catalog: ${part}` : "";
      if (words === "") notes.push({ ...here, code: "new-part", severity: "information", message: "new: needs words after it" });
      else if (!this.#harness) notes.push({ ...here, code: "new-part", severity: "information", message: "new part: no harness to draft it" });
      else if (!this.site.ownMounted) notes.push({ ...here, code: "new-part", severity: "warning", message: NOT_MOUNTED });
      else if (!latest) notes.push({ ...here, code: "new-part", severity: "information", message: `new part: the accept key drafts it${near}` });
      else if (latest.status === "drafting") notes.push({ ...here, code: "drafting", severity: "information", message: `drafting${showing}${near}` });
      else if (latest.status === "ready") notes.push({ ...here, code: "draft-ready", severity: "information", message: `${latest.name} drafted, in the preview: the accept key keeps, rerolls or cancels${sets}${near}` });
      else notes.push({ ...here, code: "draft-failed", severity: "warning", message: `draft failed: ${latest.message ?? "no reason given"}. The accept key retries${showing}` });
    }
    // A site's own part being redrafted: where its takes are.
    for (const d of scan(doc.text, this.site.catalog).directives) {
      const of = this.#ownPart(doc, d);
      if (of === undefined) continue;
      const key = ownKey(of);
      const newest = this.#draftsFor(key)[0];
      if (!newest) continue;
      const shown = this.#shown(key);
      const latest = newest.status === "ready" && shown ? shown : newest;
      const here = {
        line: d.line, start: 0, end: src[d.line]!.length,
        data: {
          status: latest.status, name: of, of, ...(latest.by ? { by: latest.by } : {}), started: latest.started,
          ...(shown && shown !== latest ? { shown: shown.original ? "the kept one" : `take ${this.#takes(key).take}` } : {}),
          ...this.#takes(key), ...(d.close === undefined ? {} : { close: d.close }),
        },
      };
      if (latest.status === "drafting") notes.push({ ...here, code: "drafting", severity: "information", message: `drafting a take of ${of}` });
      else if (latest.status === "ready") notes.push({ ...here, code: "draft-ready", severity: "information", message: `${shown?.original ? `${of} as kept` : `a take of ${of}`}, in the preview: the accept key keeps, rerolls or goes back` });
      else notes.push({ ...here, code: "draft-failed", severity: "warning", message: `take of ${of} failed: ${latest.message ?? "no reason given"}. The accept key retries or goes back` });
    }
    return notes;
  }

  // Completion of the plain form, on a line starting with ::: : the parts, then a part's settings, then a setting's values. Words
  // get nothing, by design: words are for Jev. An image setting's value, and
  // the address in a Markdown picture, get the site's pictures.
  complete(file: string, line: number, character: number): Completion[] {
    const doc = this.#docs.get(file);
    if (!doc) return [];
    if (scan(doc.text, this.site.catalog).code.has(line)) return [];
    const lineText = splitLines(doc.text)[line] ?? "";
    const picture = PICTURE_BEFORE.exec(lineText.slice(0, character));
    if (picture) return this.#pictures(picture[1]!, character - picture[1]!.length, character, false);
    const colons = /^:{3,}/.exec(lineText);
    if (!colons || character < colons[0].length) return [];

    const seg = lineText.slice(colons[0].length, character);
    // Words after a lone ":" are for Jev.
    if (/(^|\s):(\s|$)/.test(seg)) return [];
    const body = seg.trimStart();
    const bodyStart = character - body.length;
    const parts = this.#parts(doc.page);

    // The first token: a part name, or `theme` in rubric.md.
    if (!/\s/.test(body)) {
      const theme = doc.page === "site" && this.site.catalog.themes && THEME.startsWith(body)
        ? [{ label: THEME, detail: "the whole site's look, chosen from a list", kind: "part" as const, start: bodyStart, end: character, newText: THEME }]
        : [];
      return [...theme, ...Object.entries(parts)
        .filter(([name]) => name.startsWith(body))
        .map(([name, p]) => ({ label: name, detail: p.description, kind: "part" as const, start: bodyStart, end: character, newText: name }))];
    }

    const [first] = body.split(/\s+/);
    // The theme line, for an editor with no list of its own: the themes, and
    // the pieces after `palette=`, `pairing=` or `scale=`.
    const names = this.site.catalog.themes;
    if (first === THEME && names && doc.page === "site") {
      const token = body.split(/\s+/).at(-1)!;
      const tokenStart = character - token.length;
      const eq = token.indexOf("=");
      if (eq < 0) {
        return [
          ...names.themes.filter((n) => n.startsWith(token)).map((n) => ({ label: n, detail: "theme", kind: "value" as const, start: tokenStart, end: character, newText: n })),
          ...PIECES.filter((p) => p.startsWith(token)).map((p) => ({ label: `${p}=`, detail: `swap the theme's ${p}`, kind: "setting" as const, start: tokenStart, end: character, newText: `${p}=` })),
        ];
      }
      const key = token.slice(0, eq) as Piece;
      return (PIECES.includes(key) ? names[key] : [])
        .filter((n) => n.startsWith(token.slice(eq + 1)))
        .map((n) => ({ label: n, detail: key, kind: "value" as const, start: tokenStart + eq + 1, end: character, newText: n }));
    }
    // Settings and values are offered for any part, so a part in the wrong
    // place still reads as what it is; its diagnostic says where it goes.
    const all = this.site.catalog.parts;
    const part = first !== undefined && Object.hasOwn(all, first) ? all[first] : undefined;
    if (!part) return [];

    const token = /\S*$/.exec(body)![0];
    const tokenStart = character - token.length;
    const eq = token.indexOf("=");
    if (eq === -1) {
      const used = new Set([...body.matchAll(/([a-z][a-z0-9-]*)=/g)].map((m) => m[1]));
      return Object.entries(settingsOf(this.site.catalog, first!))
        .filter(([name]) => !used.has(name) && name.startsWith(token))
        .map(([name, s]) => ({
          label: name,
          detail: s.type === "choice" || s.type === "level" ? `${s.type}, default ${s.default}` : s.type,
          kind: "setting",
          start: tokenStart,
          end: character,
          newText: `${name}=`,
        }));
    }

    const key = token.slice(0, eq);
    const typed = token.slice(eq + 1);
    const defs = settingsOf(this.site.catalog, first!);
    const def = Object.hasOwn(defs, key) ? defs[key] : undefined;
    if (def?.type === "image") return this.#pictures(typed, tokenStart + eq + 1, character, true);
    const values =
      def?.type === "choice" ? def.values
      : def?.type === "level" ? def.levels
      : def?.type === "flag" ? { true: def.true ?? "yes", false: def.false ?? "no" }
      : {};
    return Object.entries(values)
      .filter(([v]) => v.startsWith(typed))
      .map(([v, description]) => ({ label: v, detail: description, kind: "value", start: tokenStart + eq + 1, end: character, newText: v }));
  }

  // The site's pictures whose address starts with what is typed. A setting's
  // value is quoted, so a value with a space in it still reads as one.
  #pictures(typed: string, start: number, end: number, quote: boolean): Completion[] {
    const prefix = typed.replace(/^"/, "");
    return pictures(this.site)
      .filter((p) => p.startsWith(prefix))
      .map((p) => {
        const newText = quote ? `"${p}"` : p;
        return { label: p, detail: "picture", kind: "file" as const, start, end, newText, ...(quote && !typed.startsWith('"') ? { filterText: p } : {}) };
      });
  }

  // Markdown for the line under the cursor: what a words line became and why,
  // or what a plain form's part and settings mean.
  hover(file: string, line: number): string | undefined {
    const doc = this.#docs.get(file);
    const d = doc && this.#directiveAt(doc, line);
    if (!doc || !d) return undefined;
    const { parts } = this.site.catalog;

    if (d.plain && Object.hasOwn(parts, d.plain.part)) {
      const part = parts[d.plain.part]!;
      const out = [`**${d.plain.part}**: ${part.description}`];
      const defs = settingsOf(this.site.catalog, d.plain.part);
      for (const s of d.plain.settings) {
        const def = defs[s.key];
        const meaning =
          def?.type === "choice" ? def.values[s.value]
          : def?.type === "level" ? def.levels[s.value]
          : undefined;
        out.push(`- \`${s.key}=${s.value}\`${meaning ? `: ${meaning}` : ""}`);
      }
      if (d.refine && refineWords(d.refine.words) !== "") {
        const hit = this.#cache.getRefine(this.site.catalog, d.plain.part, d.refine.words);
        out.push("", `After the colon, "${d.refine.words}": ${
          hit ? `asked; ${this.#refineSummary(d.plain.part, hit)}`
          : "waiting for Jev"}.`);
      }
      return out.join("\n");
    }

    if (d.kind !== "words" || d.words === undefined) return undefined;
    const hit = this.#cache.get(this.site.catalog, doc.page, d.words);
    if (!hit) {
      const error = this.#errors.get(this.#key(doc.page, d.words));
      return error ? `**Could not reach Jev.** ${error}` : "Waiting for Jev.";
    }
    const ranked = Object.entries(hit.parts).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${v.toFixed(2)}`).join(", ");
    const head =
      hit.outcome === "placed" ? `**Placed** as \`${hit.candidates[0]!.plain}\``
      : hit.outcome === "unsettled" ? `**Not sure** what this asks for: ${hit.candidates.map((c) => `\`${c.plain}\``).join(" or ")}`
      : "**Nothing in the catalog fits.**";
    const out = [head, "", `Fits ${hit.fits.toFixed(2)}. Parts: ${ranked}.`];
    for (const c of hit.candidates) {
      if (c.unsettled.length) out.push(`\`${c.part}\`: left at the default, since the line may or may not ask for it: ${c.unsettled.join(", ")}.`);
    }
    if (hit.outcome === "placed" && hit.candidates[1]) out.push(`Also close: \`${hit.candidates[1].plain}\`.`);
    out.push("", `Answered by ${hit.model}.`);
    return out.join("\n");
  }

  // Settings the words may ask for but no value clearly matches: say so, with
  // the values there are, rather than quietly keep the default.
  #unsettledMessage(partName: string, unsettled: string[]): string {
    const part = this.site.catalog.parts[partName];
    const each = unsettled.map((name) => {
      const def = part ? settingsOf(this.site.catalog, partName)[name] : undefined;
      const values = def?.type === "choice" ? Object.keys(def.values) : def?.type === "level" ? Object.keys(def.levels) : def?.type === "flag" ? ["true", "false"] : [];
      const at = def?.type === "choice" || def?.type === "level" ? ` (left at ${def.default})` : "";
      return values.length ? `${name} can be ${values.join(", ")}${at}` : name;
    });
    return `no value clearly matches what this asks of the ${partName}: ${each.join("; ")}`;
  }

  // Words after a ":" that ask more than the part's settings can say: what
  // was taken, then every value the part has, so the writer sees how near
  // the nearest is. "hard shadow" becomes shadow=deep, and the note says
  // deep is as far as shadow goes.
  #beyondMessage(partName: string, hit: Refined): string {
    const defs = settingsOf(this.site.catalog, partName);
    const took = Object.entries(hit.settings).map(([k, v]) => `${k}=${v}`);
    const offers = Object.entries(defs).flatMap(([name, def]) => {
      const values = def.type === "choice" ? Object.keys(def.values) : def.type === "level" ? Object.keys(def.levels) : def.type === "flag" ? ["true", "false"] : [];
      return values.length ? [`${name} ${values.join(", ")}`] : [];
    });
    const head = took.length ? `took ${took.join(" ")}, but some of this asks for more` : "this asks for more";
    return `${head} than ${partName}'s settings can say. ${offers.length ? `${partName} offers ${offers.join("; ")}` : `${partName} has no settings`}`;
  }

  #directiveAt(doc: Doc, line: number): Directive | undefined {
    return scan(doc.text, this.site.catalog).directives.find((d) => d.line === line);
  }

  #key(page: PageKind, words: string): string {
    return JSON.stringify([page, words]);
  }

  #rkey(part: string, words: string): string {
    return JSON.stringify(["refine", part, refineWords(words)]);
  }

  #refineSummary(part: string, hit: Refined): string {
    const said = Object.entries(hit.settings).map(([k, v]) => `${k}=${v}`);
    const out = [said.length ? `the words ask for ${said.join(" ")}` : "the words ask for no setting"];
    if (hit.unsettled.length) out.push(this.#unsettledMessage(part, hit.unsettled));
    if (hit.beyond > THRESHOLDS.yes) out.push(`some of it asks for more than ${part}'s settings can say`);
    return out.join("; ");
  }

  #schedule(file: string): void {
    clearTimeout(this.#timers.get(file));
    this.#timers.set(file, setTimeout(() => {
      this.#timers.delete(file);
      this.#askAll(file);
    }, this.pause()));
  }

  #askAll(file: string, except?: number): void {
    const doc = this.#docs.get(file);
    if (!doc) return;
    for (const d of scan(doc.text, this.site.catalog).directives) {
      if (d.kind === "words" && d.line !== except && d.words !== undefined && !this.#cache.get(this.site.catalog, doc.page, d.words)) {
        void this.#ask(doc.page, d.words);
      }
      // Words after a ":" only once the writer has changed them, never on
      // opening a page, and only for a pin with nothing wrong in it.
      if (
        this.#refiner && d.plain && d.refine && d.line !== except && d.problems.length === 0 &&
        refineWords(d.refine.words) !== "" && Object.hasOwn(this.site.catalog.parts, d.plain.part) && !this.#ownOnly(d.plain.part) &&
        !this.#cache.getRefine(this.site.catalog, d.plain.part, d.refine.words)
      ) {
        void this.#askRefine(doc.page, d.plain.part, d.refine.words);
      }
    }
  }

  // The second pass, one request per distinct part and words in flight.
  #askRefine(page: PageKind, part: string, words: string): Promise<void> {
    const key = this.#rkey(part, words);
    const running = this.#inflight.get(key);
    if (running) return running;
    const done = (async () => {
      try {
        const { refined, error, model } = await this.#refiner!(refineWords(words), part, page);
        if (!refined) {
          this.#errors.set(key, error ?? "no answer");
        } else {
          this.#errors.delete(key);
          this.#cache.setRefine(this.site.catalog, part, words, refined, model);
          await this.#cache.save(this.site.cache);
        }
      } catch (err) {
        this.#errors.set(key, (err as Error).message);
      } finally {
        this.#inflight.delete(key);
      }
      for (const file of this.#docs.keys()) this.#drawSoon(file);
    })();
    this.#inflight.set(key, done);
    return done;
  }

  // One request per distinct line in flight. An answer is cached, an error is
  // remembered for the diagnostic, and every open page is drawn again.
  #ask(page: PageKind, words: string): Promise<void> {
    const key = this.#key(page, words);
    const running = this.#inflight.get(key);
    if (running) return running;
    const done = (async () => {
      try {
        const { resolution, model } = await this.#resolver(words, page);
        if (resolution.outcome === "error") {
          this.#errors.set(key, resolution.message);
        } else {
          this.#errors.delete(key);
          this.#cache.set(this.site.catalog, page, words, resolution, model);
          await this.#cache.save(this.site.cache);
        }
      } catch (err) {
        this.#errors.set(key, (err as Error).message);
      } finally {
        this.#inflight.delete(key);
      }
      for (const file of this.#docs.keys()) this.#drawSoon(file);
    })();
    this.#inflight.set(key, done);
    return done;
  }

  // Draws the page once changes pause, so a burst of keystrokes is one
  // rebuild and one reload, not one each.
  #drawSoon(file: string): void {
    clearTimeout(this.#draws.get(file));
    this.#draws.set(file, setTimeout(() => {
      this.#draws.delete(file);
      void this.#render(file);
    }, this.#drawMs));
  }

  async #render(file: string): Promise<void> {
    const doc = this.#docs.get(file);
    if (!doc) return;
    // The text drawn, which the starters are read against: the writer may
    // type on while it's written.
    const text = doc.text;
    const { entries, diagnostics } = await this.#write(doc.rel, doc.page, text, doc.chosen);
    this.#sendStarters(file, { ...doc, text }, entries);
    this.#publish(file, [
      ...diagnostics.map((d): Note => ({ ...d, severity: d.code === "other-skin" || d.code === "theme-unpicked" ? "information" : "warning" })),
      ...this.#wordsNotes(doc, entries),
      ...this.#neededNotes(doc, entries),
      ...this.#refineNotes(doc),
      ...this.#fileNotes(doc),
      ...this.#newNotes(doc),
    ].sort((a, b) => a.line - b.line || a.start - b.start));
  }

  // The empty blocks of a page whose parts have a starter.
  starters(file: string): Starter[] {
    const doc = this.#docs.get(file);
    return doc ? this.#startersOf(doc, preprocess(doc.text, this.site.catalog, this.#resolve(doc.page, doc.chosen)).entries) : [];
  }

  #startersOf(doc: Doc, entries: Entry[]): Starter[] {
    if (doc.page === "site") return [];
    const src = splitLines(doc.text);
    const out: Starter[] = [];
    for (const e of entries) {
      if (!e.placed || !e.plain || e.close === undefined) continue;
      const name = e.plain.split(/\s/)[0]!;
      const body = this.site.catalog.parts[name]?.body;
      if (!body) continue;
      if (!src.slice(e.line + 1, e.close).every((l) => l.trim() === "")) continue;
      out.push({ line: e.line, close: e.close, opener: src[e.line]!, part: name, body: body.replace(/\n+$/, "").split("\n") });
    }
    return out;
  }

  #sendStarters(file: string, doc: Doc, entries: Entry[]): void {
    if (!this.#onStarters) return;
    const starters = this.#startersOf(doc, entries);
    const own = this.#ownLines(doc);
    const key = JSON.stringify([starters, own]);
    if (this.#starters.get(file) === key) return;
    this.#starters.set(file, key);
    this.#onStarters(file, starters, own);
  }

  // The lines of a page placing the site's own parts.
  ownLines(file: string): OwnLine[] {
    const doc = this.#docs.get(file);
    return doc ? this.#ownLines(doc) : [];
  }

  #ownLines(doc: Doc): OwnLine[] {
    const src = splitLines(doc.text);
    return scan(doc.text, this.site.catalog).directives.flatMap((d) => {
      const part = this.#ownPart(doc, d);
      if (part === undefined) return [];
      const { takes } = this.#takes(ownKey(part));
      const shared = this.#shared(part) ? (existsSync(join(this.site.root, "parts", part)) ? { changed: true as const } : { catalog: true as const }) : {};
      return [{ line: d.line, opener: src[d.line]!, part, ...(takes ? { takes } : {}), ...shared }];
    });
  }

  // The cache's lookup, with the pick the writer has moved to in its place.
  #resolve(page: PageKind, chosen: Doc["chosen"]): Resolve {
    const cached = this.#cache.resolver(this.site.catalog, page);
    return (words, kind) => {
      // A `new:` line draws its finished draft, while the writer looks at it.
      if (kind === "new") {
        const name = this.#peek?.words === words ? this.#peek.part : this.#shown(words)?.name;
        return name && Object.hasOwn(this.site.catalog.parts, name) ? parsePlain(name) : undefined;
      }
      return chosen?.words === words ? parsePlain(chosen.plain) : cached(words);
    };
  }

  async #write(rel: string, page: PageKind, text: string, chosen?: Doc["chosen"]) {
    if (page === "site") return this.#writeFrame(text, chosen);
    const out = preprocess(text, this.site.catalog, this.#resolve(page, chosen));
    // Half-typed front matter is never handed to Hugo; the page it last read
    // stays until the front matter parses again.
    const broken = frontMatterProblem(text);
    if (broken) out.diagnostics.unshift(broken);
    // Renders overlap (a keystroke, an answer arriving), so each file is
    // written whole and in order, through a folder Hugo does not watch.
    const tmp = join(this.site.root, ".rubric/tmp");
    const target = join(this.site.content, rel);
    const sidecar = join(this.site.root, ".rubric/sidecar", `${rel}.json`);
    const writes = [writeWhole(sidecar, JSON.stringify(out.entries, null, 2) + "\n", tmp)];
    // The live preview's markers and starters: the editor's content/ is a
    // preview; `rubric build` writes the page without them.
    const content = liveContent(text, out, this.site.catalog);
    if (!broken && this.#written.get(target) !== content) {
      this.#written.set(target, content);
      writes.push(writeWhole(target, content, tmp));
    }
    await Promise.all(writes);
    return out;
  }

  // rubric.md becomes the frame page, a list the layout draws around every
  // page; Hugo reads it but never publishes it. It carries the theme too: the
  // one the writer is looking at in the editor's list, else the theme line's.
  // A new theme on the line may bring another skin, so the site is opened
  // again in it, as when hugo.toml changes.
  async #writeFrame(text: string, chosen?: Doc["chosen"]) {
    this.#frame = { text, ...(chosen ? { chosen } : {}) };
    const { entries, output } = frame(text, this.site.catalog, this.#resolve("site", chosen));
    // The writer chose the theme they were looking at: the line has it now.
    if (this.#themePreview && formatThemeLine(this.#themePreview) === formatThemeLine(output.theme ?? {})) this.#themePreview = undefined;
    const tmp = join(this.site.root, ".rubric/tmp");
    const target = join(this.site.content, FRAME_PAGE);
    const page = framePage(entries, this.#themePreview ?? output.theme);
    const writes = [writeWhole(join(this.site.root, ".rubric/sidecar/rubric.md.json"), JSON.stringify(output.entries, null, 2) + "\n", tmp)];
    if (this.#written.get(target) !== page) {
      this.#written.set(target, page);
      writes.push(writeWhole(target, page, tmp));
    }
    await Promise.all(writes);
    if (output.theme?.name !== this.lineTheme) {
      this.lineTheme = output.theme?.name;
      const wanted = this.lineTheme ?? (typeof this.site.params.theme === "string" ? this.site.params.theme : "paper");
      if (wanted !== this.site.theme) void this.#retheme();
    }
    return output;
  }

  // The theme rubric.md's line names, if it names one; hugo.toml's is used
  // without one.
  lineTheme: string | undefined;
  #frame: { text: string; chosen?: Doc["chosen"] } | undefined;
  #themePreview: ThemeChoice | undefined;
  #retheming: Promise<void> | undefined;

  async #retheme(): Promise<void> {
    if (this.#retheming) return this.#retheming;
    this.#retheming = (async () => {
      try {
        const site = await openSite(this.site.root, this.lineTheme);
        if (site.theme !== this.site.theme) await this.reload(site);
      } catch {}
    })();
    try {
      await this.#retheming;
    } finally {
      this.#retheming = undefined;
    }
    // The line may have changed again while the site was opened.
    const wanted = this.lineTheme ?? (typeof this.site.params.theme === "string" ? this.site.params.theme : "paper");
    if (wanted !== this.site.theme) await this.#retheme();
  }

  // The writer is looking at a theme in the editor's list: every page is
  // drawn in it, until they choose one (and the line says so) or close the
  // list (undefined).
  async previewTheme(choice: ThemeChoice | undefined | null): Promise<void> {
    this.#themePreview = choice ?? undefined;
    if (this.#frame) await this.#writeFrame(this.#frame.text, this.#frame.chosen);
  }

  // Everything the editor's list shows, and the order to show it in: the
  // words on the theme line at `line`, if any, put the likely ones first.
  async themes(file: string, line?: number, rank?: ThemeRanker): Promise<ThemeList | undefined> {
    const doc = this.#docs.get(file);
    const d = doc && line !== undefined ? this.#directiveAt(doc, line) : undefined;
    const words = d?.kind === "theme" ? d.theme?.words : undefined;
    const list = themeList(this.site);
    if (words && rank) {
      try {
        const order = await rank(words, list.themes);
        list.themes.sort((a, b) => (order[b.name] ?? 0) - (order[a.name] ?? 0));
        list.ranked = words;
      } catch (err) {
        list.error = (err as Error).message;
      }
    }
    if (d?.kind === "theme") list.current = d.theme!.choice;
    return list;
  }

  // A picture address at the site's root that no static file answers, in an
  // image setting or a Markdown picture. The page still draws; the picture
  // is just missing from it.
  #fileNotes(doc: Doc): Note[] {
    const s = scan(doc.text, this.site.catalog);
    const src = splitLines(doc.text);
    const notes: Note[] = [];
    const check = (line: number, start: number, address: string) => {
      if (isSiteAddress(address) && !fileExists(this.site, address)) {
        notes.push({ line, start, end: start + address.length, code: "missing-file", severity: "warning", message: `no file at ${address} in static/` });
      }
    };
    const fences = new Set<number>();
    const inside = new Set<number>();
    for (const d of s.directives) {
      fences.add(d.line);
      if (d.close !== undefined) fences.add(d.close);
      for (let l = d.line + 1; l < (d.close ?? d.line + 1); l++) inside.add(l);
      const part = d.plain && Object.hasOwn(this.site.catalog.parts, d.plain.part) ? this.site.catalog.parts[d.plain.part]! : undefined;
      for (const set of d.plain?.settings ?? []) {
        if (part?.settings[set.key]?.type !== "image") continue;
        // A quoted value's span includes its quotes.
        const quoted = src[d.line]![set.valueSpan.start] === '"';
        check(d.line, set.valueSpan.start + (quoted ? 1 : 0), set.value);
      }
    }
    src.forEach((text, line) => {
      if (s.code.has(line) || fences.has(line)) return;
      for (const m of text.matchAll(PICTURES)) check(line, m.index + m[0].length - m[1]!.length, m[1]!);
      const bare = inside.has(line) ? BARE_FILE.exec(text) : null;
      if (bare) check(line, text.indexOf(bare[1]!), bare[1]!);
    });
    return notes;
  }

  // A placed part missing a setting it needs, such as a form with nowhere to
  // send: it draws, but does not work. The site's [params.rubric] may give
  // the value for every page.
  #neededNotes(doc: Doc, entries: Entry[]): Note[] {
    const src = splitLines(doc.text);
    const notes: Note[] = [];
    for (const e of entries) {
      const form = e.placed && e.plain ? parsePlain(e.plain) : undefined;
      const part = form && this.site.catalog.parts[form.part];
      if (!form || !part) continue;
      for (const [key, def] of Object.entries(part.settings)) {
        if (def.type !== "text" || !def.needed || def.default) continue;
        if (form.settings.some((s) => s.key === key && s.value.trim() !== "")) continue;
        const fromSite = def.site ? this.site.params[def.site] : undefined;
        if (typeof fromSite === "string" && fromSite.trim() !== "") continue;
        const where = def.site ? `, or \`${def.site} = "…"\` under [params.rubric] in hugo.toml for every page` : "";
        notes.push({
          line: e.line, start: 0, end: src[e.line]!.length, code: "needs-setting", severity: "warning",
          message: `${form.part} does not work yet: ${key} is not set (${def.needed}). Set ${key}= on the line${where}`,
        });
      }
    }
    return notes;
  }

  // What the second pass found, as notes on the words after the ":": a
  // setting the words speak to with no value that clearly matches, and a
  // request no setting can meet.
  #refineNotes(doc: Doc): Note[] {
    const src = splitLines(doc.text);
    const notes: Note[] = [];
    for (const d of scan(doc.text, this.site.catalog).directives) {
      if (!d.plain || !d.refine || refineWords(d.refine.words) === "" || this.#ownOnly(d.plain.part)) continue;
      const at = { line: d.line, start: d.refine.start, end: src[d.line]!.length };
      const part = d.plain.part;
      const hit = this.#cache.getRefine(this.site.catalog, part, d.refine.words);
      const error = this.#errors.get(this.#rkey(part, d.refine.words));
      if (error && !hit) {
        notes.push({ ...at, code: "jev-error", severity: "warning", message: `could not reach Jev: ${error.replace(/^could not reach Jev: /, "")}` });
        continue;
      }
      if (!hit) continue;
      if (hit.unsettled.length) notes.push({ ...at, code: "left-at-default", severity: "information", message: this.#unsettledMessage(part, hit.unsettled) });
      if (hit.beyond > THRESHOLDS.yes) notes.push({ ...at, code: "beyond-part", severity: "information", message: this.#beyondMessage(part, hit) });
    }
    return notes;
  }

  // What Jev said about each words line, as a note on the line.
  #wordsNotes(doc: Doc, entries: Entry[]): Note[] {
    const src = splitLines(doc.text);
    const notes: Note[] = [];
    for (const e of entries) {
      if (e.kind !== "words" || e.words === undefined) continue;
      const at = { line: e.line, start: 0, end: src[e.line]!.length };
      const error = this.#errors.get(this.#key(doc.page, e.words));
      const hit = this.#cache.get(this.site.catalog, doc.page, e.words);
      if (error && !hit) notes.push({ ...at, code: "jev-error", severity: "warning", message: `could not reach Jev: ${error.replace(/^could not reach Jev: /, "")}` });
      else if (hit?.outcome === "nothing-fits") {
        // rubric.md is asked only about the frame, so a line for the writing
        // fits nothing there; say where it would go.
        const message = doc.page === "site"
          ? "nothing for the frame fits; rubric.md holds only what goes around every page, and parts for the writing go in a page"
          : "nothing in the catalog fits";
        notes.push({ ...at, code: "nothing-fits", severity: "warning", message });
      }
      else if (hit?.outcome === "unsettled") notes.push({ ...at, code: "unsettled", severity: "information", message: `not sure what this asks for: ${hit.candidates.map((c) => c.plain).join(" or ")}` });
      else if (hit?.outcome === "placed" && hit.candidates[0]!.unsettled.length) {
        notes.push({ ...at, code: "left-at-default", severity: "information", message: this.#unsettledMessage(hit.candidates[0]!.part, hit.candidates[0]!.unsettled) });
      }
    }
    return notes;
  }
}

// The first line that differs between two versions of a page: where the edit
// was. Enter at the end of a line puts it on the new line, which leaves the
// line above.
// What starts a directive line, kept when accepting rewrites it: the indent
// and the colons, which may be more than three in a nested block.
function opener(line: string): string {
  return /^\s*:{3,}/.exec(line)?.[0] ?? ":::";
}

function firstChangedLine(before: string, after: string): number {
  const a = splitLines(before);
  const b = splitLines(after);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// The address Hugo gives a page, as near as the file says: its url or slug
// in the front matter, or its path, lowercased, with an index file standing
// for its folder.
export function pageUrl(rel: string, text: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const field = (name: string) => new RegExp(`^${name}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m").exec(fm)?.[1];
  const url = field("url");
  if (url) return url.startsWith("/") ? url : `/${url}`;
  const parts = rel.replace(/\\/g, "/").replace(/\.md$/, "").split("/");
  const last = parts.pop()!;
  if (last !== "_index" && last !== "index") parts.push(field("slug") ?? last);
  const path = parts.map((p) => p.toLowerCase().replace(/\s+/g, "-")).join("/");
  return path ? `/${path}/` : "/";
}

// Whether a process is still running. EPERM means it is, as someone else's.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
