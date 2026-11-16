// One process per site: the language server every editor on the site
// attaches to, over a local socket, with Hugo serving the page and the relay
// that moves the page to the writer's cursor. Editors start it through
// `rubric lsp` (bridge.ts); `rubric` in a terminal starts it in front.
//
// .rubric/serve.json says where it is: the socket, the ports, the process,
// and whether it answers with the stub. The ports stay in it after the
// process stops, so the next start takes the same ones and an open browser
// tab carries on.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, watch } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { writeWhole } from "../core/write.ts";
import { hugoSiteArgs } from "../hugo-config.ts";
import { ensureHugo } from "../hugo.ts";
import type { Drafter, Mode } from "./harness.ts";
import { openSiteServer } from "./main.ts";

export const SERVE_FILE = ".rubric/serve.json";
// The first ports a site takes: Hugo on the even one, the relay above it.
export const FIRST_PORT = 1415;

export interface Serving {
  root: string;
  port: number;
  relay: number;
  pid?: number;
  socket?: string;
  stub?: boolean;
}

// The socket's folder, made private, and refused when another user made it.
function ownDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = statSync(dir);
  if (process.getuid && st.uid !== process.getuid()) throw new Error(`${dir} belongs to another user`);
}

// Unix sockets take paths of about 100 bytes, so it is not in .rubric/.
export function socketPath(root: string, env: Record<string, string | undefined> = process.env): string {
  const dir = env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, "rubric") : join(tmpdir(), `rubric-${process.getuid?.() ?? "user"}`);
  return join(dir, `${createHash("sha256").update(root).digest("hex").slice(0, 16)}.sock`);
}

export function readServing(root: string): Serving | undefined {
  try {
    return JSON.parse(readFileSync(join(root, SERVE_FILE), "utf8")) as Serving;
  } catch {
    return undefined;
  }
}

export function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The site's process, when one is running: it answers on its socket.
export async function running(root: string): Promise<Serving | undefined> {
  const s = readServing(root);
  if (!s?.socket || !alive(s.pid)) return undefined;
  return (await reachable(s.socket)) ? s : undefined;
}

export function reachable(path: string): Promise<boolean> {
  return new Promise((done) => {
    const sock = createConnection(path);
    sock.once("connect", () => {
      sock.destroy();
      done(true);
    });
    sock.once("error", () => done(false));
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
  });
}

// The pair the site had before, when both are free; else the first free pair.
// The relay is bound as the pair is chosen, so a site starting at the same
// moment can't take it too; Hugo's port is only seen free.
async function ports(root: string): Promise<{ port: number; relay: Relay }> {
  const was = readServing(root);
  const tries = [...(was ? [was.port] : []), ...Array.from({ length: 100 }, (_, i) => FIRST_PORT + 2 * i)];
  for (const port of tries) {
    if (!(await portFree(port))) continue;
    try {
      return { port, relay: startRelay(port + 1) };
    } catch {
      // Taken: the next pair.
    }
  }
  throw new Error("no free ports from 1415 to 1615");
}

// A lock for the moment a process makes the site's socket, so two starting
// at once never both clear a stale one and listen. One left by a crash is
// taken over after a while.
async function lockStart(path: string): Promise<() => void> {
  for (const end = Date.now() + 10_000; ; await Bun.sleep(25)) {
    try {
      closeSync(openSync(path, "wx"));
      return () => rmSync(path, { force: true });
    } catch {
      try {
        if (Date.now() - statSync(path).mtimeMs > 10_000) rmSync(path, { force: true });
      } catch {
        // Gone already.
      }
      if (Date.now() > end) throw new Error(`could not take ${path}`);
    }
  }
}

export interface SiteOptions {
  stub: boolean;
  drafter?: Drafter;
  mode?: Mode;
  // Stops this long after the last editor leaves; never when not given.
  idleMs?: number;
  // Where Hugo's output and the process's own lines go.
  say?: (line: string) => void;
}

export interface RunningSite {
  url?: string;
  problem?: string;
  serving: Serving;
  stop(): Promise<void>;
  // Resolves once it has stopped, by itself or by stop().
  done: Promise<void>;
}

export async function runSite(root: string, opts: SiteOptions): Promise<RunningSite> {
  const say = opts.say ?? (() => {});
  const socket = socketPath(root);
  ownDir(join(socket, ".."));
  const unlock = await lockStart(`${socket}.lock`);
  const listener: Server = createServer();
  // An editor may connect before the site is open: it waits for it.
  const sockets = new Set<Socket>();
  const early: Socket[] = [];
  let accept: ((sock: Socket) => void) | undefined;
  listener.on("connection", (sock) => {
    sockets.add(sock);
    sock.once("close", () => sockets.delete(sock));
    if (accept) accept(sock);
    else early.push(sock);
  });
  try {
    // A second process for the site stops here.
    if (existsSync(socket)) {
      if (await reachable(socket)) throw new Error(`a rubric process is already running for ${root}`);
      rmSync(socket, { force: true });
    }
    await new Promise<void>((ok, fail) => {
      listener.once("error", fail);
      listener.listen(socket, () => ok());
    });
  } finally {
    unlock();
  }

  const { port, relay } = await ports(root);
  const relayPort = relay.port;

  let url: string | undefined;
  let problem: string | undefined;
  let hugo: ChildProcess | undefined;
  const server = await openSiteServer(root, {
    stub: opts.stub,
    ...(opts.drafter ? { drafter: opts.drafter } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
    cursor: relay.push,
    serving: () => ({ ...(url ? { url } : {}), ...(problem ? { problem } : {}) }),
  });

  // Saving from any editor updates the page: one with no server writes the
  // file, and the page is drawn from it. A page an editor holds open is the
  // editor's, never the file's.
  const soon = new Map<string, ReturnType<typeof setTimeout>>();
  const watcher = watch(root, { recursive: true }, (_, name) => {
    if (!name || !(name === "rubric.md" || (name.startsWith(`pages${sep}`) && name.endsWith(".md")))) return;
    const file = join(root, name);
    clearTimeout(soon.get(file));
    soon.set(file, setTimeout(() => {
      soon.delete(file);
      void server.workspace.fromDisk(file);
    }, 50));
  });

  const found = await ensureHugo();
  if ("error" in found) {
    problem = found.error;
    say(problem);
  } else {
    // In memory: on disk it would write public/, over what `rubric build`
    // made there, with pages that work only through this server.
    hugo = spawn(found.path, ["server", ...(await hugoSiteArgs(root)), "--renderToMemory", "--port", String(port), "--bind", "127.0.0.1"], {
      cwd: root,
      // The page reaches the relay at the address Hugo writes into it.
      env: { ...process.env, HUGO_PARAMS_RUBRIC_RELAY: `http://127.0.0.1:${relayPort}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // With this process however it ends; Hugo is not stopped with its parent.
    process.once("exit", () => hugo?.kill("SIGKILL"));
    hugo.stdout?.on("data", (b: Buffer) => say(b.toString().trimEnd()));
    hugo.stderr?.on("data", (b: Buffer) => say(b.toString().trimEnd()));
    url = `http://127.0.0.1:${port}/`;
  }

  const serving: Serving = { root, port, relay: relayPort, pid: process.pid, socket, stub: opts.stub };
  await writeWhole(join(root, SERVE_FILE), JSON.stringify(serving, null, 2) + "\n");

  let stopped = false;
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  let idle: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    clearTimeout(idle);
    if (opts.idleMs !== undefined && server.clients() === 0) idle = setTimeout(() => void stop(), opts.idleMs);
  };

  const stop = async () => {
    if (stopped) return done;
    stopped = true;
    clearTimeout(idle);
    // The path first: a process started from now on makes its own.
    rmSync(socket, { force: true });
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => listener.close(() => r()));
    if (hugo && hugo.exitCode === null) {
      const exited = new Promise((r) => hugo!.once("exit", r));
      hugo.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      if (hugo.exitCode === null) hugo.kill("SIGKILL");
    }
    watcher.close();
    for (const t of soon.values()) clearTimeout(t);
    relay.stop();
    server.dispose();
    // The ports stay for the next start; the process is gone. A process
    // started meanwhile has written its own, which stays.
    const { pid: _pid, socket: _socket, stub: _stub, ...kept } = serving;
    if (readServing(root)?.pid === process.pid) await writeWhole(join(root, SERVE_FILE), JSON.stringify(kept, null, 2) + "\n").catch(() => {});
    finish();
  };

  // Hugo gone by itself, its port taken or worse: the page is, so every
  // editor is told why.
  hugo?.once("exit", (code) => {
    if (!stopped) {
      url = undefined;
      problem = `Hugo stopped (exit ${code})`;
      say(problem);
      server.announce();
    }
  });
  // One page's mistake must not end every editor's connection, or leave Hugo
  // holding its port.
  process.on("unhandledRejection", (err) => say(`rubric: ${(err as Error)?.stack ?? String(err)}`));

  accept = (sock) => {
    clearTimeout(idle);
    void server.attach(sock, sock).then(() => {
      sock.destroy();
      armIdle();
    });
  };
  for (const sock of early.splice(0)) accept(sock);
  armIdle();

  return { ...(url ? { url } : {}), ...(problem ? { problem } : {}), serving, stop, done };
}

// The relay for the live preview's cursor: each open page listens and scrolls
// to where the writer's cursor is (rubric-live.js). The last position goes to
// a page as it connects, so a page opened by moving to another file scrolls
// straight to the cursor.
interface Relay {
  port: number;
  push: (body: string) => void;
  stop: () => void;
}

function startRelay(port: number): Relay {
  const listeners = new Set<ReadableStreamDefaultController<string>>();
  let last: string | undefined;
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  const push = (body: string) => {
    last = body;
    for (const c of listeners) {
      try {
        c.enqueue(`data: ${body}\n\n`);
      } catch {
        listeners.delete(c);
      }
    }
  };
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });
      if (url.pathname === "/events") {
        let me: ReadableStreamDefaultController<string>;
        const stream = new ReadableStream<string>({
          start(c) {
            me = c;
            listeners.add(c);
            c.enqueue(": rubric\n\n");
            if (last) c.enqueue(`data: ${last}\n\n`);
          },
          cancel() {
            listeners.delete(me);
          },
        });
        return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
      }
      return new Response("not found", { status: 404, headers: cors });
    },
  });
  return {
    port,
    push,
    stop: () => {
      for (const c of listeners) {
        try {
          c.close();
        } catch {
          // Gone already.
        }
      }
      void server.stop(true);
    },
  };
}
