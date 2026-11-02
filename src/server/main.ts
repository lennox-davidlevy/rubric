// The language server over stdio. Attaches only in a Rubric site (a folder
// with rubric.md) and only to its pages. All the work is in workspace.ts.
//
//   bun src/cli.ts lsp [--stub]

import { appendFileSync, existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CompletionItemKind, createConnection, DiagnosticSeverity, MarkupKind, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { atPlace, Cache, type PageKind } from "../core/index.ts";
import { ask, refine } from "../jev.ts";
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
      const site = await openSite(root);
      const cache = await Cache.load(site.cache);
      // A line is asked only about the parts for its place: the frame in
      // rubric.md, the parts for the writing in a page.
      const forPage = (page: PageKind) => atPlace(site.catalog, page === "site" ? "site" : "writing");
      const stubs = { site: stubResolver(forPage("site")), writing: stubResolver(forPage("post")) };
      const resolver: Resolver = opts.stub
        ? (directive, page) => stubs[page === "site" ? "site" : "writing"](directive, page)
        : async (directive, page) => {
            const asked = await ask(forPage(page), directive, page);
            // `bun run play` creates .rubric/jev.jsonl and prints each call
            // from it. A log is appended a line at a time, not written whole;
            // nothing but that printer reads it.
            const log = join(site.root, ".rubric/jev.jsonl");
            if (existsSync(log)) {
              void appendFile(log, JSON.stringify({ t: Date.now(), ...asked }) + "\n").catch(() => {});
            }
            return { resolution: asked.resolution, model: asked.model ?? "unknown" };
          };
      const refiner: Refiner = opts.stub
        ? stubRefiner(site.catalog)
        : async (words, part, page) => {
            const asked = await refine(site.catalog, part, words, page);
            const log = join(site.root, ".rubric/jev.jsonl");
            if (existsSync(log)) {
              void appendFile(log, JSON.stringify({ t: Date.now(), pass: "second", part, ...asked }) + "\n").catch(() => {});
            }
            return { ...(asked.refined ? { refined: asked.refined } : {}), ...(asked.error ? { error: asked.error } : {}), model: asked.model ?? "unknown" };
          };
      workspace = new Workspace(site, cache, resolver, (f, notes) => {
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
      }, { refiner });
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

  connection.languages.inlineCompletion.on(async (params) => {
    const f = file(params.textDocument.uri);
    if (!f || !workspace) return [];
    const ghosts = await workspace.ghost(f, params.position.line);
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

  documents.listen(connection);
  connection.listen();
}
