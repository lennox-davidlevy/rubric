// The language server for one site, which any number of editors attach to
// (src/server/site-process.ts runs it, src/server/bridge.ts connects an
// editor's stdio to it). The site, its cache, the drafter and every draft
// are the site's; each connection has its own open documents. All the work
// is in workspace.ts.

import { appendFileSync, existsSync, readFileSync, watch } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Readable, Writable } from "node:stream";
import { createConnection as connectionFor, type Connection } from "vscode-languageserver";
import {
  CompletionItemKind, createProtocolConnection, DiagnosticSeverity, MarkupKind, ProposedFeatures, StreamMessageReader, StreamMessageWriter, TextDocuments, TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { atPlace, Cache, type Catalog, type PageKind, type ThemeChoice } from "../core/index.ts";
import { ask, rankThemes, refine, traits, warm } from "../jev.ts";
import { openSite, type Site } from "../site.ts";
import { brief as shortName, DEFAULT_DRAFTER, describe, efforts, fastDrafter, HARNESSES, installed, modelProblem, models, MODES, suggested, toolHarness, type Drafter, type HarnessName, type Mode } from "./harness.ts";
import { stubHarness, stubRefiner, stubResolver, stubThemeRanker } from "./stub.ts";
import type { ThemeRanker } from "./themes.ts";
import { Workspace, type Refiner, type Resolver, type Severity } from "./workspace.ts";

export interface SiteServerOptions {
  stub: boolean;
  drafter?: Drafter;
  mode?: Mode;
  // Where the writer's cursor goes, for the live preview.
  cursor?: (body: string) => void;
  // Said to each editor as it attaches: where the page is, or why there is none.
  serving?: () => { url?: string; problem?: string };
}

export interface SiteServer {
  workspace: Workspace;
  // Serves one editor over a pair of streams; resolves when it leaves.
  attach(input: Readable, output: Writable): Promise<void>;
  clients(): number;
  // Says again to every editor where the page is, or why there is none.
  announce(): void;
  dispose(): void;
}

export async function openSiteServer(root: string, opts: SiteServerOptions): Promise<SiteServer> {
  const first = await openSite(root);
  const cache = await Cache.load(first.cache);
  let workspace!: Workspace;
  let ranker: ThemeRanker | undefined;
  // Which tool drafts new parts, with which model and effort: from the
  // editor's setup, and changed for the session from the editor's lists.
  // A draft may be made by another, chosen for it alone. One for the site:
  // each editor says its own as it attaches, and the last one said stands.
  let drafter: Drafter = opts.drafter ?? DEFAULT_DRAFTER;
  let drafterAsked = 0;
  // How drafts are asked for: fast, one turn with the files in the reply,
  // unless the writer chose the tools, to compare the two.
  let mode: Mode = opts.mode ?? "fast";
  // Said beside the drafter wherever a menu names it: tools make a draft slower.
  const withTools = () => (mode === "tools" ? ", tools" : "");
  // The drafter as a draft started now would run it.
  const running = (d: Drafter) => (mode === "fast" ? fastDrafter(d) : d);
  const shared = { lastCursor: "" };

  const severity: Record<Severity, DiagnosticSeverity> = {
    warning: DiagnosticSeverity.Warning,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  };
  const kinds = { part: CompletionItemKind.Class, setting: CompletionItemKind.Property, value: CompletionItemKind.EnumMember, file: CompletionItemKind.File };
  const file = (uri: string) => (uri.startsWith("file:") ? fileURLToPath(uri) : undefined);

  // The editors attached, each with the pages it has open. A page open in
  // two is the site's until both close it; the last change wins.
  interface Client { connection: Connection; open: Set<string> }
  const clients = new Set<Client>();
  const opens = new Map<string, number>();
  const toAll = (send: (c: Connection) => void) => { for (const c of clients) send(c.connection); };
  const toOpen = (f: string, send: (c: Connection) => void) => { for (const c of clients) if (c.open.has(f)) send(c.connection); };
  const closeFile = (f: string) => {
    const left = (opens.get(f) ?? 1) - 1;
    if (left > 0) {
      opens.set(f, left);
      return;
    }
    opens.delete(f);
    void workspace.close(f);
  };

  // The site as it is now: reloaded when hugo.toml changes.
  const current = () => workspace?.site ?? first;
  // A line is asked only about the parts for its place: the frame in
  // rubric.md, the parts for the writing in a page.
  const forPage = (page: PageKind) => atPlace(current().catalog, page === "site" ? "site" : "writing");
  const resolver: Resolver = opts.stub
    ? (directive, page) => stubResolver(forPage(page))(directive, page)
    : async (directive, page) => {
        const asked = await ask(forPage(page), directive, page);
        // `rubric calls` creates .rubric/jev.jsonl and prints each call
        // from it. A log is appended a line at a time, not written whole;
        // nothing but that printer reads it.
        const log = join(root, ".rubric/jev.jsonl");
        if (existsSync(log)) {
          void appendFile(log, JSON.stringify({ t: Date.now(), ...asked }) + "\n").catch(() => {});
        }
        return { resolution: asked.resolution, model: asked.model ?? "unknown" };
      };
  const refiner: Refiner = opts.stub
    ? (words, part, page) => stubRefiner(current().catalog)(words, part, page)
    : async (words, part, page) => {
        const asked = await refine(current().catalog, part, words, page);
        const log = join(root, ".rubric/jev.jsonl");
        if (existsSync(log)) {
          void appendFile(log, JSON.stringify({ t: Date.now(), pass: "second", part, ...asked }) + "\n").catch(() => {});
        }
        return { ...(asked.refined ? { refined: asked.refined } : {}), ...(asked.error ? { error: asked.error } : {}), model: asked.model ?? "unknown" };
      };
  // The theme list's order for the words on the theme line. Kept for the
  // session: the same words, the same order, and no second call.
  const ranked = new Map<string, Record<string, number>>();
  ranker = opts.stub ? stubThemeRanker : async (words, themes) => {
    const key = `${themes.map((t) => t.name).join(",")}\n${words}`;
    const hit = ranked.get(key);
    if (hit) return hit;
    const asked = await rankThemes(themes, words);
    const log = join(root, ".rubric/jev.jsonl");
    if (existsSync(log)) void appendFile(log, JSON.stringify({ t: Date.now(), pass: "theme", ...asked }) + "\n").catch(() => {});
    ranked.set(key, asked.order);
    return asked.order;
  };
  workspace = new Workspace(first, cache, resolver, (f, notes) => toOpen(f, (connection) => {
    void connection.sendDiagnostics({
      uri: pathToFileURL(f).href,
      diagnostics: notes.map((n) => ({
        range: { start: { line: n.line, character: n.start }, end: { line: n.line, character: n.end } },
        severity: severity[n.severity],
        code: n.code,
        source: "rubric",
        message: n.message,
        ...(n.data ? { data: n.data } : {}),
      })),
    });
  }), {
    refiner,
    // New parts are drafted by Claude Code, or by the stub with --stub.
    harness: opts.stub ? (dir, prompt, signal, log, use, resume, how) => stubHarness(current().catalog)(dir, prompt, signal, log, use, resume, how) : toolHarness(() => drafter),
    mode: () => mode,
    // The stub has no Jev to ask, so its drafts' records go without.
    ...(opts.stub ? {} : {
      traits: async (words: string) => {
        const asked = await traits(words);
        const log = join(root, ".rubric/jev.jsonl");
        if (existsSync(log)) void appendFile(log, JSON.stringify({ t: Date.now(), pass: "traits", ...asked }) + "\n").catch(() => {});
        return asked.traits;
      },
    }),
    // The stub says which drafter it stands in for, so a test can see a
    // drafter chosen for one draft reach it.
    drafter: (use) => (opts.stub
      ? { full: use ? `the stub, as ${describe(use)}` : "the stub", short: `the stub${withTools()}` }
      : { full: describe(running(use ?? drafter)), short: `${shortName(use ?? drafter)}${withTools()}` }),
    onDraft: (state) => toAll((c) => void c.sendNotification("rubric/drafted", state)),
    onStarters: (f, starters, own) => toOpen(f, (c) => void c.sendNotification("rubric/starters", { uri: pathToFileURL(f).href, starters, own })),
    onReload: (site) => toAll((c) => void c.sendNotification("rubric/alone", { parts: alone(site.catalog) })),
    onEdit: (edit) => {
      // A words line being typed will be asked soon: have the
      // connection open by then.
      if (!opts.stub) warm();
      // `rubric calls` creates .rubric/keys.jsonl: when each words line
      // was typed, for scripts/pause.ts to fit the pause to the writer.
      const keys = join(root, ".rubric/keys.jsonl");
      if (existsSync(keys)) void appendFile(keys, JSON.stringify(edit) + "\n").catch(() => {});
    },
  });

  void workspace.buildAll();
  const config = watchConfig(workspace, (m) => toAll((c) => c.console.info(m)));

  function attach(input: Readable, output: Writable): Promise<void> {
    return new Promise((done) => {
      let shutdown = false;
      let left = false;
      // An editor's exit, or its process gone, ends its connection only.
      const connection = connectionFor((logger) => createProtocolConnection(new StreamMessageReader(input), new StreamMessageWriter(output), logger), {
        initialize: () => {},
        get shutdownReceived() { return shutdown; },
        set shutdownReceived(v: boolean) { shutdown = v; },
        exit: () => leave(),
      }, ProposedFeatures.all);
      const documents = new TextDocuments(TextDocument);
      const me: Client = { connection, open: new Set() };
      clients.add(me);
      const leave = () => {
        if (left) return;
        left = true;
        clients.delete(me);
        for (const f of me.open) closeFile(f);
        me.open.clear();
        connection.dispose();
        done();
      };
      input.on("close", leave);
      input.on("end", leave);
      serveConnection(connection, documents, me);
      documents.listen(connection);
      connection.listen();
    });
  }

  function serveConnection(connection: Connection, documents: TextDocuments<TextDocument>, me: Client): void {
    connection.onInitialize(() => ({
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: [" ", "=", "/", "(", '"'] },
        hoverProvider: true,
        inlineCompletionProvider: true,
        // The parts that take nothing inside, so have no closing ":::": the
        // editor takes away the one it put below such a line.
        experimental: { rubric: { alone: alone(workspace.site.catalog) } },
      },
      serverInfo: { name: "rubric" },
    }));

    connection.onInitialized(() => {
      connection.console.info(`rubric: site ${workspace.site.root}, catalog ${workspace.site.catalog.name}@${workspace.site.catalog.version}${opts.stub ? ", stub resolver" : ""}`);
      const serving = opts.serving?.();
      if (serving) void connection.sendNotification("rubric/serving", serving);
    });

    documents.onDidOpen(({ document }) => {
      const f = file(document.uri);
      if (!f) return;
      // Open in another editor already: its text changes, and what was
      // cancelled or chosen on the page stays.
      const elsewhere = (opens.get(f) ?? 0) > (me.open.has(f) ? 1 : 0);
      if (!me.open.has(f)) {
        me.open.add(f);
        opens.set(f, (opens.get(f) ?? 0) + 1);
      }
      void (elsewhere ? workspace.change(f, document.getText()) : workspace.open(f, document.getText()));
    });
    documents.onDidChangeContent(({ document }) => {
      const f = file(document.uri);
      if (f) void workspace.change(f, document.getText());
      // RUBRIC_TRACE=<file> appends every text the server holds, to compare with the editor.
      if (process.env.RUBRIC_TRACE) appendFileSync(process.env.RUBRIC_TRACE, JSON.stringify({ t: Date.now(), v: document.version, text: document.getText() }) + "\n");
    });
    documents.onDidClose(({ document }) => {
      const f = file(document.uri);
      if (f && me.open.delete(f)) closeFile(f);
    });

    // The writer's cursor, from the Neovim plugin, to the live preview.
    connection.onNotification("rubric/cursor", (params: { uri: string; line: number }) => {
      const f = file(params.uri);
      const at = f && workspace?.cursor(f, params.line);
      if (!at || !workspace) return;
      const body = JSON.stringify(at);
      if (body === shared.lastCursor) return;
      shared.lastCursor = body;
      opts.cursor?.(body);
    });

    // The writer is done with the line: Esc, or the accept key before any
    // ghost text showed.
    connection.onNotification("rubric/ask", (params: { uri: string }) => {
      const f = file(params.uri);
      if (f && workspace) workspace.askNow(f);
    });

    // The writer moved to another pick, or left insert mode with one showing:
    // the preview follows the ghost text.
    connection.onNotification("rubric/choose", (params: { uri: string; line: number; index?: number }) => {
      const f = file(params.uri);
      if (f && workspace) workspace.choose(f, params.line, params.index);
    });

    // The editor's theme list: every theme and piece, in order for the words
    // on the theme line at `line`.
    connection.onRequest("rubric/themes", async (params: { uri: string; line?: number }) => {
      const f = file(params.uri);
      if (!f || !workspace) return null;
      return (await workspace.themes(f, params.line, ranker)) ?? null;
    });

    // The writer is looking at a theme in that list (or closed it: no theme):
    // every page is drawn in it.
    connection.onNotification("rubric/previewTheme", (params: { theme?: ThemeChoice }) => {
      void workspace?.previewTheme(params.theme);
    });

    // The writer is looking at a part near a `new:` line's words, in the list
    // of them (or closed it: no part): the preview draws it on the line.
    connection.onNotification("rubric/peek", (params: { uri: string; line: number; part?: string | null }) => {
      const f = file(params.uri);
      if (f) workspace?.peek(f, params.line, params.part ?? undefined);
    });

    // A `::: new:` line, or a line of the site's own part: what its drafts
    // are, and what the writer chose to do with them. Keep, cancel and use
    // answer a `new:` line with the line to put in its place; keep and cancel
    // a new variant's line, and plain, the line too. `variant` on build starts
    // a new variant of the line's part; `on` says whether everywhere turns its
    // variant on for every line of the part or off.
    // `drafter` drafts this one alone, in place of the writer's default; it is
    // checked before anything starts.
    type DraftParams = {
      uri: string; line: number; action?: "build" | "reroll" | "keep" | "cancel" | "stop" | "use" | "take" | "restore" | "remove" | "plain" | "everywhere";
      change?: string; global?: boolean; variant?: boolean; on?: boolean; step?: number; to?: number; part?: string; drafter?: { harness: HarnessName; model?: string | null; effort?: string | null };
    };
    connection.onRequest("rubric/draft", async (params: DraftParams): Promise<object | null> => {
      const f = file(params.uri);
      if (!f || !workspace) return null;
      let use: Drafter | undefined;
      if (params.drafter && (params.action === "build" || params.action === "reroll")) {
        const d = params.drafter;
        if (!HARNESSES.includes(d.harness)) return { error: `no harness "${d.harness}"` };
        use = { harness: d.harness, ...(d.model ? { model: d.model } : {}), ...(d.effort ? { effort: d.effort } : {}) };
        const problem = await modelProblem(use);
        if (problem) return { error: problem };
      }
      const who = use ? { drafter: use } : {};
      switch (params.action) {
        case "build": return (await workspace.build(f, params.line, { ...who, ...(params.variant === true ? { variant: true } : {}) })) ?? null;
        case "reroll": return (await workspace.build(f, params.line, { change: params.change ?? "", ...who })) ?? null;
        case "keep": return workspace.keep(f, params.line, params.global === true);
        case "cancel": return workspace.cancel(f, params.line);
        case "stop": return workspace.stop(f, params.line);
        case "take": return (await workspace.take(f, params.line, params.step === -1 ? -1 : 1, Number.isInteger(params.to) ? params.to : undefined)) ?? null;
        case "restore": return (await workspace.restore(f, params.line)) ?? null;
        case "use": return typeof params.part === "string" ? workspace.use(f, params.line, params.part) : { error: "no part named" };
        case "remove": return workspace.remove(f, params.line);
        case "plain": return workspace.plain(f, params.line);
        case "everywhere": return workspace.everywhere(f, params.line, params.on !== false);
        default: return (await workspace.look(f, params.line)) ?? null;
      }
    });

    // The tool and model that draft new parts, and what each tool offers, for
    // the editor's lists; and the writer's default from them, for the session.
    // With `harness`, that tool's models; with `model` too, the efforts that
    // model takes.
    connection.onRequest("rubric/drafter", async (params: { harness?: HarnessName; model?: string }): Promise<object> => {
      const harness = params.harness ?? drafter.harness;
      // Reaching the tool: installed, and able to list its models.
      let offered: string[] = [];
      let error: string | undefined;
      try {
        offered = await models(harness);
      } catch (err) {
        error = (err as Error).message;
      }
      return {
        harness: drafter.harness, model: drafter.model ?? null, effort: drafter.effort ?? null, short: `${shortName(drafter)}${withTools()}`,
        harnesses: [...HARNESSES], models: offered,
        // The model to offer first, when the bench has one for this tool.
        suggested: suggested(harness, offered) ?? null,
        // With a harness named, the model asked about is the request's, none
        // being the tool's default; with neither, the drafter's own.
        efforts: efforts(params.harness ? { harness, ...(params.model ? { model: params.model } : {}) } : drafter),
        ...(error ? { error } : {}),
      };
    });
    // Each tool, and whether it is installed, with its version.
    connection.onRequest("rubric/harnesses", async () => {
      return Promise.all(HARNESSES.map(async (name) => ({ name, version: (await installed(name)) ?? null })));
    });
    connection.onRequest("rubric/setDrafter", async (params: { harness: HarnessName; model?: string | null; effort?: string | null }): Promise<object> => {
      if (!HARNESSES.includes(params.harness)) return { error: `no harness "${params.harness}"` };
      const next: Drafter = { harness: params.harness, ...(params.model ? { model: params.model } : {}), ...(params.effort ? { effort: params.effort } : {}) };
      // Every editor says its drafter as it attaches; the site's own needs no check.
      if (next.harness === drafter.harness && next.model === drafter.model && next.effort === drafter.effort) return { drafter: describe(next), short: shortName(next) };
      // Checking a model can wait on the tool; a choice made meanwhile stands.
      const asked = ++drafterAsked;
      const problem = await modelProblem(next);
      if (problem) return { error: problem };
      if (asked === drafterAsked) drafter = next;
      return { drafter: describe(next), short: shortName(next) };
    });

    // Fast or with tools, for the drafts that start from now on.
    connection.onRequest("rubric/drafting", async (params: { mode?: string }): Promise<object> => {
      if (params.mode !== undefined) {
        if (!MODES.includes(params.mode as Mode)) return { error: `drafting is one of ${MODES.join(", ")}` };
        mode = params.mode as Mode;
      }
      return { mode, modes: [...MODES] };
    });

    connection.languages.inlineCompletion.on(async (params) => {
      const f = file(params.textDocument.uri);
      if (!f || !workspace) return [];
      const ghosts = await workspace.ghost(f, params.position.line);
      // Neovim shows how many picks there are only once the writer moves to
      // the next, so the plugin is told, and says so beside the first.
      void connection.sendNotification("rubric/picks", { uri: params.textDocument.uri, line: params.position.line, count: ghosts.length });
      // A refinement changes the pin mid-line, so the ghost text only shows
      // what changes and the editor's rubric.pin command writes the whole line.
      return ghosts.map((g) => ({
        insertText: g.text,
        range: { start: { line: g.line, character: g.character }, end: { line: g.line, character: g.character } },
        ...(g.replace === undefined ? {} : { command: { title: "Pin", command: "rubric.pin", arguments: [{ line: g.line, text: g.replace, ...(g.drop === undefined ? {} : { drop: g.drop }), ...(g.build ? { build: true } : {}), ...(g.change ? { change: true } : {}) }] } }),
      }));
    });

    connection.onCompletion((params) => {
      const f = file(params.textDocument.uri);
      if (!f || !workspace) return [];
      const { line, character } = params.position;
      return workspace.complete(f, line, character).map((c) => ({
        label: c.label,
        kind: kinds[c.kind],
        detail: c.detail,
        ...(c.filterText === undefined ? {} : { filterText: c.filterText }),
        textEdit: { range: { start: { line, character: c.start }, end: { line, character: c.end } }, newText: c.newText },
      }));
    });

    connection.onHover((params) => {
      const f = file(params.textDocument.uri);
      const value = f && workspace?.hover(f, params.position.line);
      return value ? { contents: { kind: MarkupKind.Markdown, value } } : null;
    });

  }

  return {
    workspace,
    attach,
    clients: () => clients.size,
    announce: () => {
      const serving = opts.serving?.();
      if (serving) toAll((c) => void c.sendNotification("rubric/serving", serving));
    },
    dispose: () => {
      config.close();
      workspace.dispose();
    },
  };
}

// Switching the theme in hugo.toml needs no restart: the site is opened again
// once the file settles and parses. Editors save by renaming, so the folder
// is watched, not the file. A half-typed hugo.toml is skipped, or a missing
// [params.rubric] would switch the site to Paper while the writer types.
function watchConfig(workspace: Workspace, say: (message: string) => void): { close(): void } {
  const root = workspace.site.root;
  const path = join(root, "hugo.toml");
  let was = existsSync(path) ? readFileSync(path, "utf8") : "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(root, (_, name) => {
    if (name !== "hugo.toml") return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
        Bun.TOML.parse(text);
      } catch {
        return;
      }
      if (text === was) return;
      was = text;
      try {
        const site = await openSite(root, workspace.lineTheme);
        await workspace.reload(site);
        say(`rubric: hugo.toml changed; theme ${String(site.params.theme ?? "paper")}${site.skin ? `, skin ${site.skin}` : ""}`);
      } catch (err) {
        say(`rubric: hugo.toml changed but the site could not be opened: ${(err as Error).message}`);
      }
    }, 150);
  });
  return { close: () => { clearTimeout(timer); watcher.close(); } };
}

// The parts that take nothing inside, for the editor.
function alone(catalog: Catalog): string[] {
  return Object.entries(catalog.parts).filter(([, p]) => p.empty && p.origin !== "draft").map(([name]) => name).sort();
}
