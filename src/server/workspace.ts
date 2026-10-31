// Everything the language server does, with no protocol in it: the document
// flow from lsp.md, ghost text, completion and hover. main.ts wires it to the
// editor. Works from the text the editor holds, never from the saved file, and
// only ever writes content/, .rubric/ and nothing the writer edits.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  Cache, preprocess, scan, lines as splitLines,
  type Diagnostic, type Directive, type Entry, type PageKind, type Resolution,
} from "../core/index.ts";
import { pageKind, pagePath, type Site } from "../site.ts";

export type Resolver = (directive: string, page: PageKind) => Promise<{ resolution: Resolution; model: string }>;

export type Severity = "warning" | "information" | "hint";
export interface Note extends Omit<Diagnostic, "code"> {
  code: string;
  severity: Severity;
}

export interface Ghost {
  // Inserted at the end of the line, which is where it is shown.
  text: string;
  line: number;
  character: number;
}

export interface Completion {
  label: string;
  detail: string;
  kind: "part" | "setting" | "value";
  // Replaces [start, end) on the line.
  start: number;
  end: number;
  newText: string;
}

interface Doc {
  text: string;
  rel: string;
  page: PageKind;
}

export interface Options {
  debounceMs?: number;
  // How long a ghost text request waits for an answer before giving up.
  waitMs?: number;
}

const PIN = " -> ";

export class Workspace {
  readonly site: Site;
  #cache: Cache;
  #resolver: Resolver;
  #publish: (file: string, notes: Note[]) => void;
  #docs = new Map<string, Doc>();
  #written = new Map<string, string>();
  #inflight = new Map<string, Promise<void>>();
  #errors = new Map<string, string>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #debounceMs: number;
  #waitMs: number;

  constructor(site: Site, cache: Cache, resolver: Resolver, publish: (file: string, notes: Note[]) => void, opts: Options = {}) {
    this.site = site;
    this.#cache = cache;
    this.#resolver = resolver;
    this.#publish = publish;
    this.#debounceMs = opts.debounceMs ?? 300;
    this.#waitMs = opts.waitMs ?? 5000;
  }

  // Writes content/ for every page on disk, from the cache only. Run once at
  // start, so the preview is whole before any page is opened.
  async buildAll(): Promise<void> {
    const files = (await readdir(this.site.pages, { recursive: true })).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const file = join(this.site.pages, f);
      if (!this.#docs.has(file)) await this.#write(f, pageKind(f), await readFile(file, "utf8"));
    }
  }

  isPage(file: string): boolean {
    return pagePath(this.site, file) !== undefined;
  }

  async open(file: string, text: string): Promise<void> {
    const rel = pagePath(this.site, file);
    if (rel === undefined) return;
    this.#docs.set(file, { text, rel, page: pageKind(rel) });
    await this.#render(file);
    this.#schedule(file);
  }

  async change(file: string, text: string): Promise<void> {
    const doc = this.#docs.get(file);
    if (!doc) return this.open(file, text);
    doc.text = text;
    await this.#render(file);
    this.#schedule(file);
  }

  // A closed page is drawn from disk again, so unsaved edits leave the preview.
  async close(file: string): Promise<void> {
    const doc = this.#docs.get(file);
    if (!doc) return;
    this.#docs.delete(file);
    clearTimeout(this.#timers.get(file));
    this.#timers.delete(file);
    try {
      await this.#write(doc.rel, doc.page, await readFile(file, "utf8"));
    } catch {}
    this.#publish(file, []);
  }

  // Waits for every answer in flight. For tests and shutdown.
  async settle(): Promise<void> {
    for (const t of this.#timers.values()) clearTimeout(t);
    for (const file of this.#timers.keys()) this.#askAll(file);
    this.#timers.clear();
    while (this.#inflight.size > 0) await Promise.all(this.#inflight.values());
  }

  // Ghost text for a words line: the plain form each candidate would pin,
  // best first. Waits for the answer when it is on its way, and asks at once
  // when it is not, since the editor has already waited for typing to stop.
  async ghost(file: string, line: number): Promise<Ghost[]> {
    const doc = this.#docs.get(file);
    const d = doc && this.#directiveAt(doc, line);
    if (!doc || !d || d.kind !== "words" || d.words === undefined) return [];

    let hit = this.#cache.get(this.site.catalog, doc.page, d.words);
    if (!hit) {
      const pending = this.#ask(doc.page, d.words);
      await Promise.race([pending, new Promise((r) => setTimeout(r, this.#waitMs))]);
      hit = this.#cache.get(this.site.catalog, doc.page, d.words);
    }
    if (!hit || hit.outcome === "nothing-fits") return [];

    const lineText = splitLines(doc.text)[line] ?? "";
    const end = lineText.length;
    const sep = lineText.endsWith(" ") ? PIN.trimStart() : PIN;
    return hit.candidates.map((c) => ({ text: `${sep}${c.plain}`, line, character: end }));
  }

  // Completion of the plain form, on a line starting with ::: and after a pin's
  // arrow: the parts, then a part's settings, then a setting's values. Words
  // get nothing, by design: words are for Jev.
  complete(file: string, line: number, character: number): Completion[] {
    const doc = this.#docs.get(file);
    if (!doc) return [];
    if (scan(doc.text, this.site.catalog).code.has(line)) return [];
    const lineText = splitLines(doc.text)[line] ?? "";
    const colons = /^:{3,}/.exec(lineText);
    if (!colons || character < colons[0].length) return [];

    let segStart = colons[0].length;
    const before = lineText.slice(0, character);
    const pin = before.lastIndexOf(PIN);
    if (pin >= segStart) segStart = pin + PIN.length;
    const seg = before.slice(segStart);
    const body = seg.trimStart();
    const bodyStart = character - body.length;
    const { parts } = this.site.catalog;

    // The first token: a part name.
    if (!/\s/.test(body)) {
      return Object.entries(parts)
        .filter(([name]) => name.startsWith(body))
        .map(([name, p]) => ({ label: name, detail: p.description, kind: "part", start: bodyStart, end: character, newText: name }));
    }

    const [first] = body.split(/\s+/);
    const part = first !== undefined && Object.hasOwn(parts, first) ? parts[first] : undefined;
    if (!part) return [];

    const token = /\S*$/.exec(body)![0];
    const tokenStart = character - token.length;
    const eq = token.indexOf("=");
    if (eq === -1) {
      const used = new Set([...body.matchAll(/([a-z][a-z0-9-]*)=/g)].map((m) => m[1]));
      return Object.entries(part.settings)
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
    const def = Object.hasOwn(part.settings, key) ? part.settings[key] : undefined;
    const values =
      def?.type === "choice" ? def.values
      : def?.type === "level" ? def.levels
      : def?.type === "flag" ? { true: def.true ?? "yes", false: def.false ?? "no" }
      : {};
    return Object.entries(values)
      .filter(([v]) => v.startsWith(typed))
      .map(([v, description]) => ({ label: v, detail: description, kind: "value", start: tokenStart + eq + 1, end: character, newText: v }));
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
      for (const s of d.plain.settings) {
        const def = part.settings[s.key];
        const meaning =
          def?.type === "choice" ? def.values[s.value]
          : def?.type === "level" ? def.levels[s.value]
          : undefined;
        out.push(`- \`${s.key}=${s.value}\`${meaning ? `: ${meaning}` : ""}`);
      }
      if (d.kind === "pinned") out.push("", "Pinned: never sent to Jev.");
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

  #directiveAt(doc: Doc, line: number): Directive | undefined {
    return scan(doc.text, this.site.catalog).directives.find((d) => d.line === line);
  }

  #key(page: PageKind, words: string): string {
    return JSON.stringify([page, words]);
  }

  #schedule(file: string): void {
    clearTimeout(this.#timers.get(file));
    this.#timers.set(file, setTimeout(() => {
      this.#timers.delete(file);
      this.#askAll(file);
    }, this.#debounceMs));
  }

  #askAll(file: string): void {
    const doc = this.#docs.get(file);
    if (!doc) return;
    for (const d of scan(doc.text, this.site.catalog).directives) {
      if (d.kind === "words" && d.words !== undefined && !this.#cache.get(this.site.catalog, doc.page, d.words)) {
        void this.#ask(doc.page, d.words);
      }
    }
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
      for (const file of this.#docs.keys()) await this.#render(file);
    })();
    this.#inflight.set(key, done);
    return done;
  }

  async #render(file: string): Promise<void> {
    const doc = this.#docs.get(file);
    if (!doc) return;
    const { entries, diagnostics } = await this.#write(doc.rel, doc.page, doc.text);
    this.#publish(file, [...diagnostics.map((d): Note => ({ ...d, severity: "warning" })), ...this.#wordsNotes(doc, entries)]);
  }

  async #write(rel: string, page: PageKind, text: string) {
    const out = preprocess(text, this.site.catalog, this.#cache.resolver(this.site.catalog, page));
    const target = join(this.site.content, rel);
    if (this.#written.get(target) !== out.content) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, out.content);
      this.#written.set(target, out.content);
    }
    const sidecar = join(this.site.root, ".rubric/sidecar", `${rel}.json`);
    await mkdir(dirname(sidecar), { recursive: true });
    await writeFile(sidecar, JSON.stringify(out.entries, null, 2) + "\n");
    return out;
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
      else if (hit?.outcome === "nothing-fits") notes.push({ ...at, code: "nothing-fits", severity: "warning", message: "nothing in the catalog fits" });
      else if (hit?.outcome === "unsettled") notes.push({ ...at, code: "unsettled", severity: "information", message: `not sure what this asks for: ${hit.candidates.map((c) => c.plain).join(" or ")}` });
      else if (hit?.outcome === "placed" && hit.candidates[0]!.unsettled.length) {
        notes.push({ ...at, code: "left-at-default", severity: "hint", message: `left at the default: ${hit.candidates[0]!.unsettled.join(", ")}` });
      }
    }
    return notes;
  }
}

