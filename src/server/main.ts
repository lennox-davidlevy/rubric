// The language server over stdio. Attaches only in a Rubric site (a folder
// with rubric.md) and only to its pages. All the work is in workspace.ts.
//
//   bun src/cli.ts lsp [--stub]

import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CompletionItemKind, createConnection, DiagnosticSeverity, MarkupKind, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Cache } from "../core/index.ts";
import { ask } from "../jev.ts";
import { findSiteRoot, openSite } from "../site.ts";
import { stubResolver } from "./stub.ts";
import { Workspace, type Resolver, type Severity } from "./workspace.ts";

export function serve(opts: { stub: boolean }): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);
  let workspace: Workspace | undefined;

  const severity: Record<Severity, DiagnosticSeverity> = {
    warning: DiagnosticSeverity.Warning,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  };
  const kinds = { part: CompletionItemKind.Class, setting: CompletionItemKind.Property, value: CompletionItemKind.EnumMember };
  const file = (uri: string) => (uri.startsWith("file:") ? fileURLToPath(uri) : undefined);

  connection.onInitialize(async (params) => {
    const from = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
    const root = from ? findSiteRoot(fileURLToPath(from)) : undefined;
    if (root) {
      const site = await openSite(root);
      const cache = await Cache.load(site.cache);
      const resolver: Resolver = opts.stub
        ? stubResolver(site.catalog)
        : async (directive, page) => {
            const asked = await ask(site.catalog, directive, page);
            return { resolution: asked.resolution, model: asked.model ?? "unknown" };
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
      });
    }
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: [" ", "="] },
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
  });
  documents.onDidClose(({ document }) => {
    const f = file(document.uri);
    if (f && workspace) void workspace.close(f);
  });

  connection.languages.inlineCompletion.on(async (params) => {
    const f = file(params.textDocument.uri);
    if (!f || !workspace) return [];
    const ghosts = await workspace.ghost(f, params.position.line);
    return ghosts.map((g) => ({
      insertText: g.text,
      range: { start: { line: g.line, character: g.character }, end: { line: g.line, character: g.character } },
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
