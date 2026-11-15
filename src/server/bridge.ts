// `rubric lsp`: what an editor starts. It reads the editor's first message to
// find the site, connects to the site's process (site-process.ts), starting
// it in the background when none is running, and then only passes bytes
// both ways. Outside a site it answers alone, with nothing to offer.
//
// A stub process and a live one never mix: a bridge asked for one refuses a
// running process that is the other, so a test never reaches a live process.

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { createConnection as connectTo, type Socket } from "node:net";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { findSiteRoot } from "../site.ts";
import { readServing, reachable, socketPath } from "./site-process.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
const REPO = join(import.meta.dir, "..", "..");

// The first message, whole, and the bytes read so far.
// Read by hand: leaving a `for await` early would close stdin.
function firstMessage(): Promise<{ message: { params?: { rootUri?: string | null; rootPath?: string | null; workspaceFolders?: { uri: string }[] | null } }; bytes: Buffer }> {
  return new Promise((done, fail) => {
    let bytes = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      const end = bytes.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(bytes.subarray(0, end).toString())?.[1]);
      if (!Number.isFinite(length)) {
        process.stdin.off("data", onData);
        fail(new Error("the editor's first message has no Content-Length"));
        return;
      }
      if (bytes.length < end + 4 + length) return;
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
      done({ message: JSON.parse(bytes.subarray(end + 4, end + 4 + length).toString()), bytes });
    };
    const onEnd = () => fail(new Error("the editor closed before saying anything"));
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

export async function bridge(opts: { stub: boolean; args: string[] }): Promise<void> {
  // Bytes after the first message stay in stdin while it decides.
  let first: Awaited<ReturnType<typeof firstMessage>>;
  try {
    first = await firstMessage();
  } catch (err) {
    process.stderr.write(`rubric: ${(err as Error).message}\n`);
    process.exit(1);
  }
  const { message, bytes } = first;
  const p = message.params ?? {};
  const from = p.workspaceFolders?.[0]?.uri ?? p.rootUri ?? (p.rootPath ? `file://${p.rootPath}` : undefined);
  const root = from?.startsWith("file:") ? findSiteRoot(fileURLToPath(from)) : undefined;
  if (!root) return alone(bytes);

  const was = readServing(root);
  if (was?.socket && was.stub !== undefined && was.stub !== opts.stub && (await reachable(was.socket))) {
    process.stderr.write(`rubric: a ${was.stub ? "stub" : "live"} process is running for ${root}; rubric stop first\n`);
    process.exit(1);
  }
  const sock = await connect(root, opts);
  if (!sock) {
    process.stderr.write(`rubric: could not start the process for ${root}; see .rubric/logs/site.log\n`);
    process.exit(1);
  }
  sock.write(bytes);
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
  process.stdin.on("end", () => sock.end());
  sock.on("close", () => process.exit(0));
  sock.on("error", () => process.exit(1));
}

// The site's socket, starting its process when nothing answers.
async function connect(root: string, opts: { stub: boolean; args: string[] }): Promise<Socket | undefined> {
  const path = socketPath(root);
  const open = () => new Promise<Socket | undefined>((done) => {
    const sock = connectTo(path);
    sock.once("connect", () => done(sock));
    sock.once("error", () => done(undefined));
  });
  const first = await open();
  if (first) return first;
  mkdirSync(join(root, ".rubric/logs"), { recursive: true });
  const log = openSync(join(root, ".rubric/logs/site.log"), "a");
  // In the repo, where Bun finds the key; on its own, so it outlives this editor.
  const child = spawn(process.execPath, [CLI, root, "--background", ...(opts.stub ? ["--stub"] : []), ...opts.args], {
    cwd: REPO, detached: true, stdio: ["ignore", log, log],
  });
  // Not started: said below, when nothing answers.
  child.on("error", () => {});
  child.unref();
  for (const end = Date.now() + 5000; Date.now() < end; await Bun.sleep(25)) {
    const sock = await open();
    if (sock) return sock;
  }
  return undefined;
}

// Outside a site: a server with nothing to offer, which says so.
function alone(bytes: Buffer): void {
  const input = new PassThrough();
  input.write(bytes);
  process.stdin.pipe(input);
  process.stdin.resume();
  const connection = createConnection(ProposedFeatures.all, input, process.stdout);
  connection.onInitialize(() => ({ capabilities: {}, serverInfo: { name: "rubric" } }));
  connection.onInitialized(() => connection.console.warn("rubric: no rubric.md above the workspace; nothing to do"));
  connection.listen();
}
