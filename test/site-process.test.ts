// One process per site: editors start it through `rubric lsp`, share it, and
// it stops by itself after the last one leaves. Hugo is a stand-in that only
// waits, so nothing is served and nothing is asked of Jev (--stub).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/node";
import { newSite } from "../src/new-site.ts";
import { alive, isHugoBuilt, readServing, socketPath } from "../src/server/site-process.ts";

const repo = join(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "rubric-process-"));
const runtime = join(tmp, "run");
const fakeHugo = join(tmp, "hugo");
const env = { ...process.env, XDG_RUNTIME_DIR: runtime, RUBRIC_HUGO: fakeHugo, RUBRIC_IDLE_MS: "400" };
const pids: number[] = [];

beforeAll(() => {
  // Waits like `hugo server` until it is stopped, noting how it was asked.
  writeFileSync(fakeHugo, `#!/bin/sh\necho "$@" >> ${JSON.stringify(join(tmp, "hugo-args"))}\nexec sleep 600\n`);
  chmodSync(fakeHugo, 0o755);
});

// Each process stops by itself once its editors leave; one that has not is
// stopped, and waited for, so its Hugo goes with it.
afterAll(async () => {
  for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGTERM");
  for (const end = Date.now() + 5000; pids.some(alive) && Date.now() < end; ) await Bun.sleep(25);
  for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
});

interface Editor {
  conn: MessageConnection;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  notes: Map<string, { code?: string | number }[]>;
}

async function editor(root: string, flags: string[] = ["--stub"]): Promise<Editor> {
  const proc = Bun.spawn(["bun", join(repo, "src/cli.ts"), "lsp", ...flags], { cwd: repo, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const { Readable, Writable } = await import("node:stream");
  const conn = createMessageConnection(
    new StreamMessageReader(Readable.fromWeb(proc.stdout as never)),
    new StreamMessageWriter(new Writable({ write: (chunk, _, done) => { proc.stdin.write(chunk); done(); } })),
  );
  const notes = new Map<string, { code?: string | number }[]>();
  conn.onNotification("textDocument/publishDiagnostics", (p: { uri: string; diagnostics: { code?: string | number }[] }) => {
    notes.set(p.uri, p.diagnostics);
  });
  conn.onNotification(() => {});
  conn.onRequest(() => null);
  conn.listen();
  await conn.sendRequest("initialize", { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} });
  await conn.sendNotification("initialized", {});
  return { conn, proc, notes };
}

async function leave(e: Editor): Promise<void> {
  await e.conn.sendRequest("shutdown").catch(() => {});
  await e.conn.sendNotification("exit").catch(() => {});
  e.conn.dispose();
  e.proc.stdin.end();
  await Promise.race([e.proc.exited, Bun.sleep(3000)]);
  e.proc.kill();
}

const until = async (f: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(25)) if (f()) return true;
  return false;
};

const open = (e: Editor, file: string, text: string) =>
  e.conn.sendNotification("textDocument/didOpen", { textDocument: { uri: pathToFileURL(file).href, languageId: "markdown", version: 1, text } });

test("two editors share one process; each gets the notes of the pages it has open; it stops after the last leaves", async () => {
  const root = join(tmp, "shared");
  newSite(root);
  const a = await editor(root);
  const serving = readServing(root)!;
  pids.push(serving.pid!);
  expect(alive(serving.pid)).toBe(true);
  expect(serving.stub).toBe(true);
  // The preview's pages stay in memory, never in public/, where a build is.
  expect(await until(() => existsSync(join(tmp, "hugo-args")))).toBe(true);
  expect(readFileSync(join(tmp, "hugo-args"), "utf8")).toContain("--renderToMemory");
  const b = await editor(root);
  expect(readServing(root)!.pid).toBe(serving.pid);

  const page = join(root, "pages/posts/first.md");
  const text = "---\ntitle: First\n---\n\n::: quote size=huge\nSaid.\n:::\n";
  await open(a, page, text);
  const uri = pathToFileURL(page).href;
  expect(await until(() => (a.notes.get(uri) ?? []).some((n) => n.code === "value-not-allowed"))).toBe(true);
  // Notes go only to an editor with the page open.
  expect(b.notes.has(uri)).toBe(false);
  await open(b, page, text);
  expect(await until(() => (b.notes.get(uri) ?? []).some((n) => n.code === "value-not-allowed"))).toBe(true);
  // A change from one reaches the other's notes.
  await a.conn.sendNotification("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: text.replace("huge", "large") }] });
  expect(await until(() => !(b.notes.get(uri) ?? []).some((n) => n.code === "value-not-allowed"))).toBe(true);
  expect(readFileSync(join(root, "content/posts/first.md"), "utf8")).toContain('size="large"');

  await leave(a);
  await Bun.sleep(600);
  expect(alive(serving.pid)).toBe(true);
  await leave(b);
  expect(await until(() => !alive(serving.pid))).toBe(true);
  expect(existsSync(socketPath(root, env))).toBe(false);
  // The ports stay for the next start.
  expect(readServing(root)).toEqual({ root, port: serving.port, relay: serving.relay });
}, 20_000);

test("a live bridge refuses a site whose running process is the stub", async () => {
  const root = join(tmp, "mixed");
  newSite(root);
  const stub = await editor(root);
  pids.push(readServing(root)!.pid!);
  const live = Bun.spawn(["bun", join(repo, "src/cli.ts"), "lsp"], { cwd: repo, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} } });
  live.stdin.write(`Content-Length: ${Buffer.byteLength(init)}\r\n\r\n${init}`);
  expect(await Promise.race([live.exited, Bun.sleep(5000).then(() => "hung")])).toBe(1);
  await leave(stub);
}, 20_000);

test("a page saved by an editor with no server is drawn from the file; one an editor holds open is not", async () => {
  const root = join(tmp, "saved");
  newSite(root);
  const e = await editor(root);
  pids.push(readServing(root)!.pid!);
  const first = join(root, "pages/posts/first.md");
  const content = join(root, "content/posts/first.md");
  writeFileSync(first, "---\ntitle: First\n---\n\n::: quote\nSaved.\n:::\n");
  expect(await until(() => existsSync(content) && readFileSync(content, "utf8").includes("{{< quote >}}"))).toBe(true);
  // Held open, the editor's text is the page, whatever the file says.
  await open(e, first, "---\ntitle: First\n---\n\nTyped, not saved.\n");
  expect(await until(() => readFileSync(content, "utf8").includes("Typed, not saved."))).toBe(true);
  writeFileSync(first, "---\ntitle: First\n---\n\nOn disk.\n");
  await Bun.sleep(300);
  expect(readFileSync(content, "utf8")).toContain("Typed, not saved.");
  await leave(e);
}, 20_000);

test("rubric stop leaves alone a process whose pid a crashed one left behind", () => {
  const root = join(tmp, "stale");
  newSite(root);
  mkdirSync(join(root, ".rubric"), { recursive: true });
  // This test's own pid, alive, with no socket answering for the site.
  writeFileSync(join(root, ".rubric/serve.json"), JSON.stringify({ root, port: 1499, relay: 1500, pid: process.pid, socket: join(runtime, "nothing.sock"), stub: true }));
  const r = Bun.spawnSync(["bun", join(repo, "src/cli.ts"), "stop", root], { cwd: repo, env });
  expect(r.stdout.toString().trim()).toBe("not running");
});

test("isHugoBuilt matches Hugo build completion lines only", () => {
  expect(isHugoBuilt("Built in 9 ms")).toBe(true);
  expect(isHugoBuilt("Total in 3 ms")).toBe(true);
  expect(isHugoBuilt("Total in 1.2 s")).toBe(true);
  expect(isHugoBuilt("Total in 450 µs")).toBe(true);
  expect(isHugoBuilt("Source changed /posts/long.md")).toBe(false);
  expect(isHugoBuilt("Web Server is available at //localhost:1415/")).toBe(false);
});

test("the SSE relay broadcasts monotonic built revisions and replays the latest on connect", async () => {
  const root = join(tmp, "relay-built");
  newSite(root);
  const chattyHugo = join(tmp, "chatty-hugo");
  writeFileSync(chattyHugo, `#!/bin/sh\necho "Built in 9 ms"\nsleep 0.2\necho "Total in 3 ms"\nexec sleep 600\n`);
  chmodSync(chattyHugo, 0o755);
  const proc = Bun.spawn(["bun", join(repo, "src/cli.ts"), "lsp", "--stub"], { cwd: repo, env: { ...env, RUBRIC_HUGO: chattyHugo }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const { Readable, Writable } = await import("node:stream");
  const conn = createMessageConnection(
    new StreamMessageReader(Readable.fromWeb(proc.stdout as never)),
    new StreamMessageWriter(new Writable({ write: (chunk, _, done) => { proc.stdin.write(chunk); done(); } })),
  );
  conn.onNotification(() => {});
  conn.onRequest(() => null);
  conn.listen();
  await conn.sendRequest("initialize", { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} });
  await conn.sendNotification("initialized", {});
  const serving = readServing(root)!;
  pids.push(serving.pid!);

  const readEvents = async (want: number): Promise<unknown[]> => {
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${serving.relay}/events`, { signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const out: unknown[] = [];
    let buf = "";
    try {
      while (out.length < want) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const frame of buf.split("\n\n")) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) out.push(JSON.parse(line.slice(6)));
        }
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    } finally {
      ac.abort();
      reader.releaseLock();
    }
    return out;
  };

  // Wait for both builds from chattyHugo, then verify a fresh SSE client gets built >= 2 immediately.
  const saw = await readEvents(2);
  expect(saw.some((e) => typeof (e as { built?: number }).built === "number")).toBe(true);
  await Bun.sleep(300);
  const fresh = await readEvents(1);
  expect((fresh[0] as { built?: number }).built).toBeGreaterThanOrEqual(2);

  await leave({ conn, proc, notes: new Map() });
}, 20_000);
