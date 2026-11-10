// The language server over stdio. Attaches only in a Rubric site (a folder
// with rubric.md) and only to its pages. All the work is in workspace.ts.
//
//   bun src/cli.ts lsp [--stub]

import { appendFileSync, existsSync, readFileSync, watch } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CompletionItemKind, createConnection, DiagnosticSeverity, MarkupKind, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { atPlace, Cache, type PageKind } from "../core/index.ts";
import { ask, refine, warm } from "../jev.ts";
import { findSiteRoot, openSite } from "../site.ts";
import { stubRefiner, stubResolver } from "./stub.ts";
import { Workspace, type Refiner, type Resolver, type Severity } from "./workspace.ts";

export function serve(opts: { stub: boolean }): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);
  let workspace: Workspace | undefined;

  const severity: Record<Severity, DiagnosticSeverity> = {
    warning: DiagnosticSeverity.Warning,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  };
  const kinds = { part: CompletionItemKind.Class, setting: CompletionItemKind.Property, value: CompletionItemKind.EnumMember, file: CompletionItemKind.File };
  const file = (uri: string) => (uri.startsWith("file:") ? fileURLToPath(uri) : undefined);

  connection.onInitialize(async (params) => {
    const from = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
    const root = from ? findSiteRoot(fileURLToPath(from)) : undefined;
    if (root) {
      const first = await openSite(root);
      const cache = await Cache.load(first.cache);
      // The site as it is now: reloaded when hugo.toml changes.
      const current = () => workspace?.site ?? first;
      // A line is asked only about the parts for its place: the frame in
      // rubric.md, the parts for the writing in a page.
      const forPage = (page: PageKind) => atPlace(current().catalog, page === "site" ? "site" : "writing");
      const resolver: Resolver = opts.stub
        ? (directive, page) => stubResolver(forPage(page))(directive, page)
        : async (directive, page) => {
            const asked = await ask(forPage(page), directive, page);
            // `bun run play` creates .rubric/jev.jsonl and prints each call
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
      workspace = new Workspace(first, cache, resolver, (f, notes) => {
        void connection.sendDiagnostics({
          uri: pathToFileURL(f).href,
          diagnostics: notes.map((n) => ({
            range: { start: { line: n.line, character: n.start }, end: { line: n.line, character: n.end } },
            severity: severity[n.severity],
            code: n.code,
            source: "rubric",
            message: n.message,
          })),
        });
      }, {
        refiner,
        onEdit: (edit) => {
          // A words line being typed will be asked soon: have the
          // connection open by then.
          if (!opts.stub) warm();
          // `bun run play` creates .rubric/keys.jsonl: when each words line
          // was typed, for scripts/pause.ts to fit the pause to the writer.
          const keys = join(root, ".rubric/keys.jsonl");
          if (existsSync(keys)) void appendFile(keys, JSON.stringify(edit) + "\n").catch(() => {});
        },
      });
    }
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: [" ", "=", "/", "(", '"'] },
        hoverProvider: true,
        inlineCompletionProvider: true,
      },
      serverInfo: { name: "rubric" },
    };
  });

  connection.onInitialized(() => {
    if (!workspace) {
      connection.console.warn("rubric: no rubric.md above the workspace; nothing to do");
      return;
    }
    connection.console.info(`rubric: site ${workspace.site.root}, catalog ${workspace.site.catalog.name}@${workspace.site.catalog.version}${opts.stub ? ", stub resolver" : ""}`);
    void workspace.buildAll();
    watchConfig(workspace, (m) => connection.console.info(m));
  });

  documents.onDidOpen(({ document }) => {
    const f = file(document.uri);
    if (f && workspace) void workspace.open(f, document.getText());
  });
  documents.onDidChangeContent(({ document }) => {
    const f = file(document.uri);
    if (f && workspace) void workspace.change(f, document.getText());
    // RUBRIC_TRACE=<file> appends every text the server holds, to compare with the editor.
    if (process.env.RUBRIC_TRACE) appendFileSync(process.env.RUBRIC_TRACE, JSON.stringify({ t: Date.now(), v: document.version, text: document.getText() }) + "\n");
  });
  documents.onDidClose(({ document }) => {
    const f = file(document.uri);
    if (f && workspace) void workspace.close(f);
  });

  // The writer's cursor, from the Neovim plugin, passed to `bun run play`'s
  // relay so the live preview follows it. Nothing happens when play is not
  // running; the post fails at once and is dropped.
  let lastCursor = "";
  connection.onNotification("rubric/cursor", (params: { uri: string; line: number }) => {
    const f = file(params.uri);
    const at = f && workspace?.cursor(f, params.line);
    if (!at || !workspace) return;
    const body = JSON.stringify(at);
    if (body === lastCursor) return;
    lastCursor = body;
    const relay = String(workspace.site.params.relay ?? "http://127.0.0.1:1416");
    void fetch(`${relay}/cursor`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(500) }).catch(() => {});
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
      ...(g.replace === undefined ? {} : { command: { title: "Pin", command: "rubric.pin", arguments: [{ line: g.line, text: g.replace }] } }),
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

  // Other servers on the site then draw this one's pages from disk again.
  process.on("exit", () => workspace?.dispose());
  documents.listen(connection);
  connection.listen();
}

// Switching the theme in hugo.toml needs no restart: the site is opened again
// once the file settles and parses. Editors save by renaming, so the folder
// is watched, not the file. A half-typed hugo.toml is skipped, or a missing
// [params.rubric] would switch the site to Paper while the writer types.
function watchConfig(workspace: Workspace, say: (message: string) => void): void {
  const root = workspace.site.root;
  const path = join(root, "hugo.toml");
  let was = existsSync(path) ? readFileSync(path, "utf8") : "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(root, (_, name) => {
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
        const site = await openSite(root);
        await workspace.reload(site);
        say(`rubric: hugo.toml changed; theme ${String(site.params.theme ?? "paper")}${site.skin ? `, skin ${site.skin}` : ""}`);
      } catch (err) {
        say(`rubric: hugo.toml changed but the site could not be opened: ${(err as Error).message}`);
      }
    }, 150);
  });
}
