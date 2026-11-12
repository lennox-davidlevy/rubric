// The tool that drafts a new part: Claude Code or OpenCode, run headless,
// with the model the writer chose. Each runs in a folder of its own outside
// the repository, so no project's instructions or settings reach it: it may
// read and write in that folder only, with no shell, no web and no MCP
// servers, and the Jev key is not in its environment. The brief and any
// earlier draft are copied in, and what it wrote is copied back. Minutes are
// fine, since a part is written once and kept; ten is the most.

import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import type { Harness } from "./draft.ts";

export const HARNESSES = ["claude", "opencode"] as const;
export type HarnessName = (typeof HARNESSES)[number];

// Which tool drafts, with which model and how hard it thinks; none is the
// tool's default. Effort is Claude Code's --effort, or an OpenCode variant.
export interface Drafter {
  harness: HarnessName;
  model?: string;
  effort?: string;
}

// A tool's conversation, kept to go on with: a reroll by the same tool and
// model resumes it (a copy of it), so the model holds what it reasoned about
// the part. Each tool keeps its sessions by the folder it ran in, so `cwd` is
// that folder, made again for the reroll.
export interface Session {
  id: string;
  harness: HarnessName;
  model?: string;
  cwd: string;
}

// What a run cost, as the tool reports it, for the record.
export interface RunStats {
  turns?: number;
  cost?: number;
  // Tokens: everything read (cached or not), cached reads alone, written,
  // and of those written, thinking.
  input?: number;
  cached?: number;
  output?: number;
  thinking?: number;
  apiSeconds?: number;
}

// What drafts unless the writer chose otherwise: a fast model. Any one
// draft can be made by another, chosen for it alone.
export const DEFAULT_DRAFTER: Drafter = { harness: "claude", model: "sonnet", effort: "low" };

// How hard a model can be asked to think: Claude Code's --effort levels for
// any model, and OpenCode's built-in variants, which differ by provider
// (opencode.ai/docs/models). An unlisted provider offers none.
export function efforts(d: Pick<Drafter, "harness" | "model">): string[] {
  if (d.harness === "claude") return ["low", "medium", "high", "xhigh", "max"];
  const provider = d.model?.split("/")[0];
  if (provider === "openai") return ["minimal", "low", "medium", "high", "xhigh"];
  if (provider === "anthropic") return ["high", "max"];
  if (provider === "google") return ["low", "high"];
  return [];
}

// The model to offer first for a tool that has no settled default of its
// own, best first, from the bench (docs/plan.md, "Faster drafts"): the
// first of these the tool lists. OpenCode has only the providers the writer
// signed in to, so there may be none.
const SUGGESTED: Record<HarnessName, string[]> = {
  claude: [],
  opencode: ["openai/gpt-6.1-terra-fast", "openai/gpt-6.1-terra", "openai/gpt-6.1-sol-fast", "openai/gpt-6.1-sol"],
};
export function suggested(harness: HarnessName, offered: string[]): string | undefined {
  return SUGGESTED[harness].find((m) => offered.includes(m));
}

// How a draft is asked for. "tools": the tool reads the brief in its folder
// and writes the files there, a turn a step. "fast": one turn with no tools,
// the brief in the prompt and the files in the reply, which we write.
export const MODES = ["fast", "tools"] as const;
export type Mode = (typeof MODES)[number];

// What the model is told it is, in a fast draft, in place of the tool's own
// long instructions for working in a codebase.
export const FAST_SYSTEM = "You draft one part for a Rubric website: a few small files, returned in your reply exactly in the format the brief asks for. You have no tools and no folder to look in; the brief has everything. Reply with the files and nothing else.";
// Added when the writer chose no effort, or a low one: thinking before
// writing is where a draft's time goes.
export const FAST_QUICK = " The writer is waiting and can ask for another take, so do not plan or weigh alternatives first: take the first good design that comes to mind and write the files at once.";

// The drafter a fast draft runs with: the writer's, at low effort when they
// chose none and the model takes one.
export function fastDrafter(d: Drafter): Drafter {
  return d.effort || !efforts(d).includes("low") ? d : { ...d, effort: "low" };
}

function fastSystem(d: Drafter): string {
  return FAST_SYSTEM + (!d.effort || ["minimal", "low"].includes(d.effort) ? FAST_QUICK : "");
}

// The files a draft is made of, copied back from the tool's folder.
const RESULT = ["part.yaml", "part.html", "part.css", "exists.txt"];

// Claude Code's short names for its latest models; it also takes full names.
const CLAUDE_ALIASES = ["opus", "sonnet", "haiku", "fable"];

// What the tool is started with: its command line and what is added to its
// environment.
export function command(d: Drafter, prompt: string, resume?: string, mode: Mode = "tools"): { args: string[]; env: Record<string, string> } {
  const claudeEnv = {
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: "1",
  };
  if (d.harness === "claude" && mode === "fast") {
    return {
      args: [
        "claude", "-p", prompt,
        // The reply as it is written, so the log can say which file it is on.
        "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        // The same isolation as a draft with tools, and no tools at all: the
        // reply is the draft. A short system prompt of ours in place of the
        // tool's, and no conversation kept, since nothing goes on with it.
        "--setting-sources", "local",
        "--strict-mcp-config",
        "--restricted",
        "--disable-slash-commands",
        "--tools", "",
        "--system-prompt", fastSystem(d),
        "--no-session-persistence",
        ...(d.model ? ["--model", d.model] : []),
        ...(d.effort ? ["--effort", d.effort] : []),
      ],
      env: claudeEnv,
    };
  }
  if (d.harness === "claude") {
    return {
      args: [
        "claude", "-p", prompt,
        // An event a line as it works, so the draft's log can follow it.
        "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits",
        // None of the writer's own setup: no settings, MCP servers, skills or
        // commands, and only the tools a draft needs, held to its folder.
        "--setting-sources", "local",
        "--strict-mcp-config",
        "--restricted",
        "--disable-slash-commands",
        "--tools", "Read,Write,Edit,Glob,Grep",
        "--allowedTools", "Read(./**)", "Write(./**)", "Edit(./**)", "Glob", "Grep",
        "--disallowedTools", "Bash", "WebFetch", "WebSearch", "Task", "Agent",
        ...(d.model ? ["--model", d.model] : []),
        ...(d.effort ? ["--effort", d.effort] : []),
        // A copy of the earlier conversation, which stays as it was.
        ...(resume ? ["--resume", resume, "--fork-session"] : []),
      ],
      // No CLAUDE.md or AGENTS.md of the writer's, no memory of its own, and
      // none of the bundled skills and agents a draft has no use for.
      env: claudeEnv,
    };
  }
  // Every tool denied but reading and writing in its folder; a private
  // server, so this environment is the one it runs with.
  // A fast draft is denied those too, and is told what it is in the prompt,
  // OpenCode having no flag for a system prompt.
  const permission = mode === "fast" ? { "*": "deny" } : {
    "*": "deny", read: "allow", edit: "allow", glob: "allow", grep: "allow", list: "allow", external_directory: "deny",
  };
  return {
    // The variant goes on the model's name: provider/model#variant.
    args: [
      "opencode", "run", "--standalone", "--archived", "--format", "json",
      ...(d.model ? ["--model", d.effort ? `${d.model}#${d.effort}` : d.model] : []),
      ...(resume ? ["--session", resume, "--fork"] : []),
      mode === "fast" ? `${fastSystem(d)}\n\n${prompt}` : prompt,
    ],
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission }),
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
  };
}

// The models the tool offers, for the editor's list: OpenCode's own list,
// or Claude Code's short names.
const listed = new Map<HarnessName, Promise<string[]>>();
export function models(harness: HarnessName): Promise<string[]> {
  if (harness === "claude") return Promise.resolve(CLAUDE_ALIASES);
  let list = listed.get(harness);
  if (!list) {
    list = (async () => {
      const [out, code] = await withOpenCodeAlone(async (env) => {
        const proc = Bun.spawn(["opencode", "models"], { env, stdout: "pipe", stderr: "ignore", stdin: "ignore", signal: AbortSignal.timeout(20_000) });
        return Promise.all([new Response(proc.stdout).text(), proc.exited]);
      });
      if (code !== 0) throw new Error("opencode models failed");
      return out.split("\n").map((l) => l.trim()).filter((l) => /^[\w.-]+\/\S+$/.test(l));
    })();
    list.catch(() => listed.delete(harness));
    listed.set(harness, list);
  }
  return list;
}

// Whether the tool is installed, and its version, for the editor's list.
export async function installed(harness: HarnessName): Promise<string | undefined> {
  if (!Bun.which(harness)) return undefined;
  try {
    const proc = Bun.spawn([harness, "--version"], { env: toolEnv(), stdout: "pipe", stderr: "ignore", stdin: "ignore", signal: AbortSignal.timeout(5000) });
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return out.trim().split("\n")[0] || "installed";
  } catch {
    return "installed";
  }
}

// Why the tool can't draft with this model, before a minute is spent on it.
export async function modelProblem(d: Drafter): Promise<string | undefined> {
  if (d.effort && !efforts(d).includes(d.effort)) {
    const offered = efforts(d);
    return `${d.model ?? d.harness} has no effort "${d.effort}"${offered.length ? `; it takes ${offered.join(", ")}` : ""}`;
  }
  if (!d.model) return undefined;
  if (d.harness === "claude") {
    return CLAUDE_ALIASES.includes(d.model) || /^claude-[\w.-]+$/.test(d.model) ? undefined : `Claude Code has no model "${d.model}"`;
  }
  try {
    return (await models("opencode")).includes(d.model) ? undefined : `opencode has no model "${d.model}"; opencode models lists them`;
  } catch {
    return undefined;
  }
}

// The harness for whichever tool and model `drafter` says when a draft starts.
// Given a session (`resume`), it goes on with that conversation when the same
// tool and model draft again, in the folder it ran in; otherwise, or when the
// tool can't find it, it starts fresh. Either way the brief in the folder
// says all there is to do.
export function toolHarness(drafter: () => Drafter, limitMs = 10 * 60_000): Harness {
  // One draft keeps the drafter it started with, through its second try,
  // even if the writer chooses another meanwhile.
  const kept = new Map<string, Drafter>();
  return async (dir, prompt, signal, log = () => {}, use, resume, mode = "tools") => {
    const chosen = kept.get(dir) ?? use ?? drafter();
    const d = mode === "fast" ? fastDrafter(chosen) : chosen;
    kept.set(dir, chosen);
    setTimeout(() => kept.delete(dir), limitMs * 2).unref?.();
    const problem = await modelProblem(d);
    if (problem) return { error: problem };
    if (!Bun.which(d.harness)) return { error: `${d.harness} is not installed, or not on the PATH` };
    await sweep(limitMs);
    const drafted = { drafter: d };
    // A fast draft is one call that stands alone: the brief has the last
    // take's files, and no conversation is kept or gone on with.
    if (mode === "fast") {
      const only = await run(d, dir, prompt, signal, log, limitMs, undefined, mode);
      return { ...drafted, ...only.result, resumed: false };
    }
    if (resume && (resume.harness !== d.harness || (resume.model ?? "") !== (d.model ?? ""))) {
      log(`the last take was drafted by ${resume.harness} with ${resume.model ?? "its default model"}, so this one starts fresh`);
      resume = undefined;
    }
    // Only a folder of ours, in the temporary folder, is made again.
    if (resume && !ownFolder(resume.cwd)) {
      log("the last take's conversation is in a folder that isn't a draft's, so this one starts fresh");
      resume = undefined;
    }
    // OpenCode makes a new, empty conversation for an id it doesn't have, so
    // it's looked for first, in OpenCode's own store; no model is asked.
    if (resume?.harness === "opencode" && !(await openCodeHas(resume.id))) {
      log("OpenCode no longer has the last take's conversation, so this one starts fresh");
      resume = undefined;
    }
    const first = await run(d, dir, prompt, signal, log, limitMs, resume);
    if (first.inUse) {
      log("the last take's folder is in use, so this one starts fresh");
      const fresh = await run(d, dir, prompt, signal, log, limitMs);
      return { ...drafted, ...fresh.result, resumed: false };
    }
    // The tool couldn't find the conversation: it stopped before any turn.
    // Once it has worked, a failure is the draft's, and isn't run again.
    if (first.error && resume && !first.started && !signal.aborted && !first.timedOut) {
      log(`could not go on with the last conversation (${first.error}); starting fresh`);
      const again = await run(d, dir, prompt, signal, log, limitMs);
      return { ...drafted, ...again.result, stats: sum(first.result.stats, again.result.stats), runs: 2, resumed: false };
    }
    return { ...drafted, ...first.result, resumed: resume !== undefined && !first.error };
  };
}

// The environment a tool is started with: this one, as it is now, without
// the Jev key.
function toolEnv(): Record<string, string | undefined> {
  const { TYPESAFE_API_KEY: _, ...env } = process.env;
  return env;
}

// OpenCode settings that name more of the writer's own config, kept from a draft.
const OPENCODE_OWN = ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"];

// OpenCode as drafts run it, for its model list too: an empty config
// folder, so a model the list offers is one a draft can use.
async function withOpenCodeAlone<T>(f: (env: Record<string, string | undefined>) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "rubric-opencode-config-"));
  try {
    const env = toolEnv();
    for (const v of OPENCODE_OWN) delete env[v];
    return await f({ ...env, XDG_CONFIG_HOME: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// A draft's own folder in the temporary folder, as the tool's runs make them.
function ownFolder(path: string): boolean {
  return dirname(path) === tmpdir() && basename(path).startsWith("rubric-draft-") && !path.split(sep).includes("..");
}

async function openCodeHas(id: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["opencode", "session", "export", id], { cwd: tmpdir(), env: toolEnv(), stdout: "ignore", stderr: "ignore", stdin: "ignore", signal: AbortSignal.timeout(15_000) });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function sum(a: RunStats | undefined, b: RunStats | undefined): RunStats {
  const out: RunStats = { ...a };
  for (const [k, v] of Object.entries(b ?? {}) as [keyof RunStats, number | undefined][]) {
    if (typeof v === "number") out[k] = Math.round(((out[k] ?? 0) + v) * 1000) / 1000;
  }
  return out;
}

type Ran = { error?: string; timedOut?: boolean; started?: boolean; inUse?: boolean; result: { error?: string; stats?: RunStats; session?: Session; reply?: string } };

// One run of the tool, in a folder of its own: a new one, or the session's,
// claimed whole, so two runs never share one.
async function run(d: Drafter, dir: string, prompt: string, signal: AbortSignal, log: (line: string) => void, limitMs: number, resume?: Session, mode: Mode = "tools"): Promise<Ran> {
  const fast = mode === "fast";
  let work: string;
  if (resume) {
    try {
      await mkdir(resume.cwd);
    } catch {
      return { inUse: true, result: {} };
    }
    work = resume.cwd;
  } else work = await mkdtemp(join(tmpdir(), "rubric-draft-"));
  let configDir: string | undefined;
  try {
    // A fast draft's folder stays empty: there is nothing for it to read.
    if (!fast) await cp(dir, work, { recursive: true, filter: (src) => !/(state\.json|harness\.log|draft\.log)$/.test(src) });
    const { args, env: extra } = command(d, prompt, resume?.id, mode);
    // OpenCode reads the writer's global config folder (~/.config/opencode:
    // its AGENTS.md, agents, skills and MCP servers) whatever else is set; an
    // empty one of the draft's own keeps them out. Sign-in and sessions are
    // in its data folder, which stays.
    if (d.harness === "opencode") {
      configDir = await mkdtemp(join(tmpdir(), "rubric-opencode-config-"));
      extra.XDG_CONFIG_HOME = configDir;
    }
    const env = toolEnv();
    // Nor a config file or folder named in the environment.
    if (d.harness === "opencode") for (const v of OPENCODE_OWN) delete env[v];
    const stop = AbortSignal.any([signal, AbortSignal.timeout(limitMs)]);
    log(`started ${describe(d)}${resume ? ", going on with the last take's conversation" : ""}`);
    // PWD too: OpenCode takes its folder from it, not from where it starts.
    const proc = Bun.spawn(args, { cwd: work, env: { ...env, ...extra, PWD: work }, stdout: "pipe", stderr: "pipe", stdin: "ignore", signal: stop });
    const writing = fast ? progress(log) : undefined;
    const [out, err, code] = await Promise.all([
      lines(proc.stdout, (line) => {
        // The log never stops a draft: an event it can't read is left out.
        try {
          if (writing) writing(d.harness, line);
          else {
            const said = readable(d.harness, line);
            if (said) log(said);
          }
        } catch {}
      }),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    // The command without the prompt, which is long and the same every
    // time. Each run of a draft is added, so a second try keeps the first's.
    // Nor a fast draft's reply a piece at a time: the whole of it follows.
    const shown = args.map((a) => (a.endsWith(prompt) ? "<prompt>" : a)).join(" ");
    const kept = fast ? out.split("\n").filter((l) => !l.startsWith('{"type":"stream_event"')).join("\n") : out;
    await appendFile(join(dir, "harness.log"), `${shown}\n\n${kept}\n${err}\n`).catch(() => {});
    // Measured whatever happened: a run stopped or out of time cost too.
    const measured = measure(d.harness, out);
    const started = (measured.stats.turns ?? 0) > 0 || (measured.stats.output ?? 0) > 0;
    const fail = (error: string, timedOut = false): Ran => ({ error, timedOut, started, result: { error, stats: measured.stats } });
    if (signal.aborted) return fail("stopped");
    if (stop.aborted) return fail(`it took more than ${Math.round(limitMs / 60_000)} minutes`, true);
    const said = failure(d.harness, out);
    if (code !== 0 || said) {
      const last = err.trim() ? err.trim().split("\n").at(-1) : out.trim().split("\n").reverse().map((l) => { try { return readable(d.harness, l); } catch { return undefined; } }).find(Boolean);
      return fail(said ?? `${d.harness} exited with ${code}${last ? `: ${last}` : ""}`);
    }
    if (fast) return { started, result: { stats: measured.stats, reply: replyText(d.harness, out) } };
    for (const f of RESULT) {
      if (existsSync(join(work, f))) await cp(join(work, f), join(dir, f));
      else await rm(join(dir, f), { force: true });
    }
    const session: Session | undefined = measured.session ? { id: measured.session, harness: d.harness, ...(d.model ? { model: d.model } : {}), cwd: work } : undefined;
    return { started, result: { stats: measured.stats, ...(session ? { session } : {}) } };
  } finally {
    await rm(work, { recursive: true, force: true });
    if (configDir) await rm(configDir, { recursive: true, force: true });
  }
}

// A line naming a file in a fast draft's reply, as the brief asks for them.
export const FILE_LINE = /^=== (part\.yaml|part\.html|part\.css)\s*$/;

// What the model replied, whole: Claude Code's result, or OpenCode's text.
export function replyText(harness: HarnessName, out: string): string {
  const events = out.split("\n").flatMap((l) => {
    try {
      const e = JSON.parse(l) as Record<string, any>;
      return e && typeof e === "object" ? [e] : [];
    } catch {
      return [];
    }
  });
  if (harness === "claude") {
    const r = events.findLast((e) => e.type === "result");
    if (typeof r?.result === "string" && r.result.trim()) return r.result;
    return events.filter((e) => e.type === "assistant").flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []))
      .filter((c: Record<string, any>) => c?.type === "text" && typeof c.text === "string").map((c: Record<string, any>) => c.text).join("");
  }
  return events.filter((e) => e.type === "text" && typeof e.part?.text === "string").map((e) => e.part.text).join("\n");
}

// A fast draft's log: each file as the reply starts on it, then how the run
// ended. The reply itself is the draft, and isn't said again.
function progress(log: (line: string) => void): (harness: HarnessName, line: string) => void {
  let text = "";
  let said = 0;
  const files = (more: string) => {
    text += more;
    const lines = text.split("\n");
    // The last line may be half written.
    text = lines.pop() ?? "";
    for (const l of lines) {
      const file = FILE_LINE.exec(l)?.[1];
      if (file && said++ < 12) log(`writing ${file}`);
    }
  };
  return (harness, line) => {
    const e = JSON.parse(line) as Event;
    if (!e || typeof e !== "object") return;
    if (harness === "claude") {
      if (e.type === "stream_event") {
        const ev: Event = e.event ?? {};
        if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") log("thinking");
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") files(ev.delta.text);
        return;
      }
      if (e.type === "assistant" || e.type === "user") return;
    } else if (e.type === "text") {
      if (typeof e.part?.text === "string") files(`${e.part.text}\n`);
      return;
    }
    const other = readable(harness, line);
    if (other) log(other);
  };
}

// What a run cost and its session, from the tool's own report: Claude Code's
// result event, or the sum of OpenCode's steps.
export function measure(harness: HarnessName, out: string): { stats: RunStats; session?: string } {
  const events = out.split("\n").flatMap((l) => {
    try {
      const e = JSON.parse(l) as Record<string, any>;
      return e && typeof e === "object" ? [e] : [];
    } catch {
      return [];
    }
  });
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  if (harness === "claude") {
    const r = events.findLast((e) => e.type === "result");
    if (!r) return { stats: {} };
    const u = r.usage ?? {};
    return {
      stats: {
        turns: num(r.num_turns), cost: num(r.total_cost_usd),
        input: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens),
        cached: num(u.cache_read_input_tokens), output: num(u.output_tokens), thinking: num(u.output_tokens_details?.thinking_tokens),
        apiSeconds: Math.round(num(r.duration_api_ms) / 100) / 10,
      },
      ...(typeof r.session_id === "string" ? { session: r.session_id } : {}),
    };
  }
  const steps = events.filter((e) => e.type === "step_finish" && e.part?.tokens);
  const stats: RunStats = { turns: steps.length, cost: 0, input: 0, cached: 0, output: 0, thinking: 0 };
  for (const e of steps) {
    const t = e.part.tokens;
    stats.input! += num(t.input) + num(t.cache?.read) + num(t.cache?.write);
    stats.cached! += num(t.cache?.read);
    stats.output! += num(t.output);
    stats.thinking! += num(t.reasoning);
    stats.cost! += num(e.part.cost);
  }
  const session = events.findLast((e) => typeof e.sessionID === "string")?.sessionID as string | undefined;
  return { stats, ...(session ? { session } : {}) };
}

// Folders left by a server that stopped mid-draft (the editor quit): none
// lives longer than a draft may take, so older ones are no one's.
async function sweep(limitMs: number): Promise<void> {
  const names = await readdir(tmpdir()).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => n.startsWith("rubric-draft-") || n.startsWith("rubric-opencode-config-")).map(async (n) => {
    const path = join(tmpdir(), n);
    const s = await stat(path).catch(() => undefined);
    if (s && Date.now() - s.mtimeMs > limitMs + 60_000) await rm(path, { recursive: true, force: true }).catch(() => {});
  }));
}

// Reads a stream a line at a time as it comes; resolves with all of it.
async function lines(stream: ReadableStream<Uint8Array>, each: (line: string) => void): Promise<string> {
  const decoder = new TextDecoder();
  let all = "";
  let rest = "";
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    const parts = (rest + text).split("\n");
    rest = parts.pop() ?? "";
    for (const line of parts) each(line);
  }
  if (rest) each(rest);
  return all;
}

type Event = Record<string, any>;

// What a tool's event says, in a line for the draft's log, or nothing for
// the ones that say nothing to the writer.
export function readable(harness: HarnessName, line: string): string | undefined {
  let e: Event;
  try {
    e = JSON.parse(line) as Event;
  } catch {
    return line.trim() || undefined;
  }
  if (!e || typeof e !== "object") return undefined;
  const content = (m: Event | undefined): Event[] => (Array.isArray(m?.content) ? m!.content.filter((c: unknown) => c && typeof c === "object") : []);
  if (harness === "claude") {
    if (e.type === "system" && e.subtype === "init") return e.model ? `model ${e.model}` : undefined;
    if (e.type === "assistant") {
      const said = content(e.message).map((c: Event) =>
        c.type === "text" ? short(c.text) : c.type === "tool_use" ? tool(c.name, c.input) : undefined).filter(Boolean);
      return said.length ? said.join("\n") : undefined;
    }
    if (e.type === "user") {
      const bad = content(e.message).filter((c: Event) => c.type === "tool_result" && c.is_error);
      return bad.length ? bad.map((c: Event) => `  refused: ${short(typeof c.content === "string" ? c.content : JSON.stringify(c.content))}`).join("\n") : undefined;
    }
    if (e.type === "result") {
      const cost = typeof e.total_cost_usd === "number" ? `, $${e.total_cost_usd.toFixed(3)}` : "";
      return `${e.is_error ? "the tool failed" : "the tool is done"}${e.num_turns ? ` after ${e.num_turns} turns` : ""}${cost}${e.is_error && e.result ? `: ${short(e.result)}` : ""}`;
    }
    return undefined;
  }
  const part: Event = e.part ?? {};
  if (e.type === "tool_use") {
    const state: Event = part.state ?? {};
    const failed = state.status === "error" ? `\n  refused: ${short(String(state.error ?? state.output ?? ""))}` : "";
    return tool(part.tool, state.input) + failed;
  }
  if (e.type === "text") return short(part.text);
  if (e.type === "step_finish" && part.tokens) {
    const t: Event = part.tokens;
    return `  a step done: ${t.input ?? 0} tokens in, ${t.output ?? 0} out${typeof part.cost === "number" && part.cost > 0 ? `, $${part.cost.toFixed(3)}` : ""}`;
  }
  if (e.type === "error") return `error: ${e.error?.data?.message ?? e.error?.message ?? "the tool reported an error"}`;
  return undefined;
}

function short(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const one = text.replace(/\s+/g, " ").trim();
  return one ? (one.length > 300 ? `${one.slice(0, 300)}…` : one) : undefined;
}

// A tool call, by what it was given: the file it read or wrote, or what it looked for.
function tool(name: unknown, input: Event | undefined): string {
  const i = input ?? {};
  // OpenCode's patch tool names its files inside the patch.
  if (typeof i.patchText === "string") {
    const files = [...i.patchText.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)].map((m) => `${m[1]!.toLowerCase()} ${m[2]!.replace(/^.*\/rubric-draft-[^/]+\//, "")}`);
    if (files.length) return `patch: ${files.join(", ")}`;
  }
  const what = i.file_path ?? i.filePath ?? i.path ?? i.pattern ?? i.query;
  const verb = String(name ?? "a tool").toLowerCase();
  return `${verb}${typeof what === "string" ? ` ${what.replace(/^.*\/rubric-draft-[^/]+\//, "")}` : ""}`;
}

// The error the tool reported in its JSON output, if any.
function failure(harness: HarnessName, out: string): string | undefined {
  if (harness === "claude") {
    // The result is the last event.
    for (const line of out.split("\n").reverse()) {
      try {
        const r = JSON.parse(line) as { type?: string; is_error?: boolean; result?: string };
        if (r.type === "result") return r.is_error ? (r.result ?? "Claude Code said it failed") : undefined;
      } catch {}
    }
    return undefined;
  }
  // OpenCode writes one event a line.
  for (const line of out.split("\n")) {
    try {
      const e = JSON.parse(line) as { type?: string; error?: { message?: string; data?: { message?: string } } };
      if (e.type === "error") return e.error?.data?.message ?? e.error?.message ?? "opencode reported an error";
    } catch {}
  }
  return undefined;
}

export function describe(d: Drafter): string {
  return `${d.harness} with ${d.model ?? "its default model"}${d.effort ? ` at ${d.effort} effort` : ""}`;
}

// A drafter in a few words, for a menu: "sonnet, low".
export function brief(d: Drafter): string {
  return `${d.model ?? `${d.harness}'s default`}${d.effort ? `, ${d.effort}` : ""}`;
}
