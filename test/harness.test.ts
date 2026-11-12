// How a drafting tool is started (docs/plan.md, step 7): with the writer's
// model, in a folder of its own outside the repository, without the Jev key,
// and held to reading and writing in that folder. A fake `opencode` and
// `claude` on the PATH record what they were given and write a part, so
// nothing is spent.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReply } from "../src/server/draft.ts";
import { command, efforts, fastDrafter, modelProblem, toolHarness, type Drafter } from "../src/server/harness.ts";

let tmp: string;
let bin: string;
let path: string | undefined;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "rubric-harness-"));
  bin = join(tmp, "bin");
  mkdirSync(bin);
  // Records its arguments, environment and folder, then drafts a part, or
  // lists models.
  const fake = (name: string) => {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh
if [ "$1" = "models" ]; then printf 'openai/gpt-6.1-sol\\nanthropic/claude-opus-5-5\\n'; exit 0; fi
if [ "$1" = "session" ]; then if [ -f "${tmp}/no-session" ]; then exit 1; fi; exit 0; fi
printf '%s\\n' "$@" > "${tmp}/${name}.args"
case " $* " in *" --resume "*|*" --session "*)
  if [ -f "${tmp}/fail-resume" ]; then printf '%s\\n' '{"type":"result","is_error":true,"result":"No conversation found"}'; exit 1; fi
  if [ -f "${tmp}/fail-after-start" ]; then printf '%s\\n' '{"type":"result","is_error":true,"result":"overloaded","num_turns":4,"total_cost_usd":0.4,"usage":{"output_tokens":900}}'; exit 1; fi;;
esac
printf '%s\\n' "$@" > "${tmp}/${name}.args"
env > "${tmp}/${name}.env"
pwd > "${tmp}/${name}.cwd"
test -f brief.md && cp brief.md "${tmp}/${name}.brief"
if [ -f "${tmp}/reply" ]; then
  ls -A > "${tmp}/${name}.ls"
  ${name === "opencode"
    ? `printf '%s\\n' '{"type":"text","sessionID":"ses_9","part":{"text":"=== part.yaml\\nname: lanterns\\ndescription: Lanterns.\\nchildren: true\\n=== part.html\\n<div class=\\"part part-lanterns\\">{{ .inner }}</div>\\n=== part.css\\n.part-lanterns { color: var(--ink); }"}}' '{"type":"step_finish","sessionID":"ses_9","part":{"cost":0.01,"tokens":{"input":10,"output":5,"reasoning":0,"cache":{"read":0,"write":0}}}}'`
    : `printf '%s\\n' '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"=== part.yaml\\nname: lanterns\\n=== part.css\\n.part"}}}' '{"type":"result","is_error":false,"session_id":"sess-9","num_turns":1,"total_cost_usd":0.03,"duration_api_ms":800,"usage":{"output_tokens":40},"result":"=== part.yaml\\nname: lanterns\\ndescription: Lanterns.\\nchildren: true\\n=== part.html\\n<div class=\\"part part-lanterns\\">{{ .inner }}</div>\\n=== part.css\\n.part-lanterns { color: var(--ink); }"}'`}
  exit 0
fi
printf 'name: lanterns\\ndescription: Lanterns.\\nchildren: true\\n' > part.yaml
printf '<div class="part part-lanterns">{{ .inner }}</div>\\n' > part.html
printf '.part-lanterns { color: var(--ink); }\\n' > part.css
printf 'stray\\n' > notes.txt
${name === "opencode"
    ? `printf '%s\\n' '{"type":"tool_use","part":{"tool":"write","state":{"status":"completed","input":{"filePath":"part.css"}}}}' '{"type":"step_finish","sessionID":"ses_1","part":{"cost":0.01,"tokens":{"input":10,"output":5,"reasoning":2,"cache":{"read":7,"write":0}}}}'`
    : `printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"part.css"}}]}}' '{"type":"result","is_error":false,"result":"done","session_id":"sess-1","num_turns":3,"total_cost_usd":0.25,"duration_api_ms":1500,"usage":{"input_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":20,"output_tokens":40,"output_tokens_details":{"thinking_tokens":30}}}'`}
`);
    chmodSync(file, 0o755);
  };
  fake("opencode");
  fake("claude");
  path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  process.env.TYPESAFE_API_KEY = "secret-for-the-test";
});

afterAll(() => {
  process.env.PATH = path;
  delete process.env.TYPESAFE_API_KEY;
  rmSync(tmp, { recursive: true, force: true });
});

function draftDir(name: string): string {
  const dir = join(tmp, "drafts", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brief.md"), "> lanterns\n");
  writeFileSync(join(dir, "state.json"), "{}\n");
  return dir;
}

test("OpenCode drafts with the chosen model, in a folder of its own, held to it", async () => {
  const dir = draftDir("opencode");
  const logged: string[] = [];
  const result = await toolHarness(() => ({ harness: "opencode", model: "openai/gpt-6.1-sol" }))(dir, "Read brief.md", new AbortController().signal, (l) => logged.push(l));
  expect(result.error).toBeUndefined();
  // What it did is told as it goes: the file it wrote is in the log.
  expect(logged.some((l) => l.includes("part.css"))).toBe(true);
  const args = readFileSync(join(tmp, "opencode.args"), "utf8").trim().split("\n");
  expect(args.slice(0, 1)).toEqual(["run"]);
  expect(args[args.indexOf("--model") + 1]).toBe("openai/gpt-6.1-sol");
  expect(args).toContain("--standalone");
  // Not the draft's folder, and not inside the repository.
  const cwd = readFileSync(join(tmp, "opencode.cwd"), "utf8").trim();
  expect(cwd).not.toBe(dir);
  expect(cwd.startsWith(join(import.meta.dir, ".."))).toBe(false);
  expect(existsSync(cwd)).toBe(false);
  expect(existsSync(join(tmp, "opencode.brief"))).toBe(true);
  // No Jev key; everything denied but its own folder's files.
  const env = readFileSync(join(tmp, "opencode.env"), "utf8");
  expect(env).not.toContain("secret-for-the-test");
  // OpenCode takes its folder from PWD.
  expect(/^PWD=(.*)$/m.exec(env)?.[1]).toBe(cwd);
  const config = JSON.parse(/^OPENCODE_CONFIG_CONTENT=(.*)$/m.exec(env)![1]!) as { permission: Record<string, string> };
  expect(config.permission["*"]).toBe("deny");
  expect(config.permission.external_directory).toBe("deny");
  expect(config.permission.bash ?? config.permission["*"]).toBe("deny");
  expect(env).toMatch(/^OPENCODE_DISABLE_CLAUDE_CODE=1$/m);
  // The part comes back; nothing else it wrote does.
  expect(readFileSync(join(dir, "part.yaml"), "utf8")).toContain("name: lanterns");
  expect(existsSync(join(dir, "notes.txt"))).toBe(false);
});

test("Claude Code drafts with the chosen model, with tools held to its folder", async () => {
  const dir = draftDir("claude");
  const logged: string[] = [];
  const result = await toolHarness(() => ({ harness: "claude", model: "opus" }))(dir, "Read brief.md", new AbortController().signal, (l) => logged.push(l));
  expect(result.error).toBeUndefined();
  expect(logged.some((l) => l.includes("part.css"))).toBe(true);
  const args = readFileSync(join(tmp, "claude.args"), "utf8").trim().split("\n");
  expect(args[args.indexOf("--model") + 1]).toBe("opus");
  expect(args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"))).toEqual(["Read(./**)", "Write(./**)", "Edit(./**)", "Glob", "Grep"]);
  expect(args.slice(args.indexOf("--disallowedTools") + 1)).toContain("Bash");
  expect(readFileSync(join(tmp, "claude.env"), "utf8")).not.toContain("secret-for-the-test");
  expect(existsSync(join(dir, "part.css"))).toBe(true);
});

test("a fast draft is one call with no tools and nothing in its folder: the files come back in the reply, and no conversation is kept or gone on with", async () => {
  writeFileSync(join(tmp, "reply"), "");
  try {
    for (const name of ["claude", "opencode"] as const) {
      const dir = draftDir(`fast-${name}`);
      const logged: string[] = [];
      const model = name === "claude" ? "opus" : "openai/gpt-6.1-sol";
      const earlier = { id: "earlier", harness: name, model, cwd: join(tmpdir(), "rubric-draft-earlier") };
      const result = await toolHarness(() => ({ harness: name, model }))(dir, "the whole brief", new AbortController().signal, (l) => logged.push(l), undefined, earlier, "fast");
      expect(result.error).toBeUndefined();
      const files = parseReply(result.reply ?? "");
      expect(Object.keys(files)).toEqual(["part.yaml", "part.html", "part.css"]);
      expect(files["part.yaml"]).toContain("name: lanterns");
      // Nothing was there to read, and nothing was copied back.
      expect(readFileSync(join(tmp, `${name}.ls`), "utf8").trim()).toBe("");
      expect(existsSync(join(dir, "part.yaml"))).toBe(false);
      expect(result.session).toBeUndefined();
      expect(result.resumed).toBe(false);
      // Low effort, the writer having chosen none.
      expect(result.drafter).toMatchObject({ model, effort: "low" });
      expect(result.stats?.turns).toBe(1);
      expect(logged.some((l) => l.includes("part.css"))).toBe(true);
      expect(readFileSync(join(tmp, `${name}.env`), "utf8")).not.toContain("secret-for-the-test");
      const args = readFileSync(join(tmp, `${name}.args`), "utf8").split("\n");
      expect(args).not.toContain("earlier");
      expect(args.some((a) => a.endsWith("the whole brief"))).toBe(true);
    }
    const args = readFileSync(join(tmp, "claude.args"), "utf8").split("\n");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--effort") + 1]).toBe("low");
    for (const flag of ["--restricted", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt", "--no-session-persistence"]) expect(args).toContain(flag);
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("local");
    const env = readFileSync(join(tmp, "claude.env"), "utf8");
    for (const v of ["CLAUDE_CODE_DISABLE_CLAUDE_MDS", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS"]) expect(env).toMatch(new RegExp(`^${v}=1$`, "m"));
    expect(args).not.toContain("--allowedTools");
    const config = /^OPENCODE_CONFIG_CONTENT=(.*)$/m.exec(readFileSync(join(tmp, "opencode.env"), "utf8"))![1]!;
    expect(JSON.parse(config).permission).toEqual({ "*": "deny" });
  } finally {
    rmSync(join(tmp, "reply"), { force: true });
  }
  // An effort the writer chose is theirs; a model that takes no low effort gets none.
  expect(fastDrafter({ harness: "claude", model: "opus", effort: "high" }).effort).toBe("high");
  expect(fastDrafter({ harness: "opencode", model: "anthropic/claude-opus-5-5" }).effort).toBeUndefined();
});

test("a model the tool doesn't have fails at once, before anything runs", async () => {
  expect(await modelProblem({ harness: "opencode", model: "openai/gpt-6.1-sol" })).toBeUndefined();
  expect(await modelProblem({ harness: "opencode", model: "openai/no-such-model" })).toBeDefined();
  expect(await modelProblem({ harness: "claude", model: "opus" })).toBeUndefined();
  expect(await modelProblem({ harness: "claude", model: "gpt-6" })).toBeDefined();
  rmSync(join(tmp, "opencode.args"), { force: true });
  const dir = draftDir("bad-model");
  const result = await toolHarness(() => ({ harness: "opencode", model: "openai/no-such-model" }))(dir, "x", new AbortController().signal);
  expect(result.error).toBeDefined();
  expect(existsSync(join(tmp, "opencode.args"))).toBe(false);
});

test("the default drafter runs with its model and effort, and one chosen for a draft in its place: Claude Code's --effort, OpenCode's variant on the model", async () => {
  const fallback: Drafter = { harness: "claude", model: "sonnet", effort: "low" };
  const harness = toolHarness(() => fallback);
  await harness(draftDir("default"), "x", new AbortController().signal, () => {});
  const claude = readFileSync(join(tmp, "claude.args"), "utf8").trim().split("\n");
  expect([claude[claude.indexOf("--model") + 1], claude[claude.indexOf("--effort") + 1]]).toEqual(["sonnet", "low"]);
  await harness(draftDir("chosen"), "x", new AbortController().signal, () => {}, { harness: "opencode", model: "openai/gpt-6.1-sol", effort: "high" });
  const opencode = readFileSync(join(tmp, "opencode.args"), "utf8").trim().split("\n");
  expect(opencode[opencode.indexOf("--model") + 1]).toBe("openai/gpt-6.1-sol#high");
  // No effort: the tool's own.
  expect(command({ harness: "claude", model: "opus" }, "x").args).not.toContain("--effort");
  expect(command({ harness: "opencode", model: "openai/gpt-6.1-sol" }, "x").args).toContain("openai/gpt-6.1-sol");
});

test("neither tool brings the writer's own setup: Claude Code has only the draft's tools and no CLAUDE.md or memory; OpenCode has an empty config folder of its own", async () => {
  const dir = draftDir("isolated-claude");
  await toolHarness(() => ({ harness: "claude", model: "opus" }))(dir, "x", new AbortController().signal);
  const args = readFileSync(join(tmp, "claude.args"), "utf8").trim().split("\n");
  expect(args[args.indexOf("--tools") + 1]).toBe("Read,Write,Edit,Glob,Grep");
  expect(args).toContain("--restricted");
  expect(args).toContain("--disable-slash-commands");
  const env = readFileSync(join(tmp, "claude.env"), "utf8");
  for (const v of ["CLAUDE_CODE_DISABLE_CLAUDE_MDS", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS"]) expect(env).toMatch(new RegExp(`^${v}=1$`, "m"));

  // A config file or folder named in the environment stays out too.
  process.env.OPENCODE_CONFIG_DIR = join(tmp, "my-opencode");
  try {
    await toolHarness(() => ({ harness: "opencode", model: "openai/gpt-6.1-sol" }))(draftDir("isolated-opencode"), "x", new AbortController().signal);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
  }
  expect(readFileSync(join(tmp, "opencode.env"), "utf8")).not.toContain("OPENCODE_CONFIG_DIR");
  const config = /^XDG_CONFIG_HOME=(.*)$/m.exec(readFileSync(join(tmp, "opencode.env"), "utf8"))?.[1];
  expect(config).toBeDefined();
  expect(config!.startsWith(join(tmpdir(), "rubric-opencode-config-"))).toBe(true);
  // Its own, and gone with the run.
  expect(existsSync(config!)).toBe(false);
});

test("a run says what it cost and gives its session, from each tool's own report", async () => {
  const claude = await toolHarness(() => ({ harness: "claude", model: "opus" }))(draftDir("measured-claude"), "x", new AbortController().signal);
  expect(claude.stats).toEqual({ turns: 3, cost: 0.25, input: 125, cached: 100, output: 40, thinking: 30, apiSeconds: 1.5 });
  expect(claude.session).toMatchObject({ id: "sess-1", harness: "claude", model: "opus" });
  const opencode = await toolHarness(() => ({ harness: "opencode", model: "openai/gpt-6.1-sol" }))(draftDir("measured-opencode"), "x", new AbortController().signal);
  expect(opencode.stats).toMatchObject({ turns: 1, input: 17, cached: 7, output: 5, thinking: 2, cost: 0.01 });
  expect(opencode.session?.id).toBe("ses_1");
});

test("a reroll goes on with the last take's conversation only when the same tool and model draft it", async () => {
  const harness = (model: string) => toolHarness(() => ({ harness: "claude", model }));
  const first = await harness("opus")(draftDir("resume-1"), "x", new AbortController().signal);
  const session = first.session!;
  // Same tool and model: a copy of that conversation, in the folder it ran in.
  const logged: string[] = [];
  const again = await harness("opus")(draftDir("resume-2"), "x", new AbortController().signal, (l) => logged.push(l), undefined, session);
  const args = readFileSync(join(tmp, "claude.args"), "utf8").trim().split("\n");
  expect(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 3)).toEqual(["--resume", "sess-1", "--fork-session"]);
  expect(readFileSync(join(tmp, "claude.cwd"), "utf8").trim()).toBe(session.cwd);
  expect(again.resumed).toBe(true);
  expect(existsSync(session.cwd)).toBe(false);
  // Another model: fresh, and the log says why.
  const other = await harness("sonnet")(draftDir("resume-3"), "x", new AbortController().signal, (l) => logged.push(l), undefined, session);
  expect(readFileSync(join(tmp, "claude.args"), "utf8")).not.toContain("--resume");
  expect(other.resumed).toBe(false);
  expect(logged.some((l) => l.includes("starts fresh"))).toBe(true);
  // A conversation the tool can't find: fresh, once, and the draft still comes.
  writeFileSync(join(tmp, "fail-resume"), "");
  try {
    const lost = await harness("opus")(draftDir("resume-4"), "x", new AbortController().signal, () => {}, undefined, session);
    expect(lost.error).toBeUndefined();
    expect(lost.resumed).toBe(false);
    expect(readFileSync(join(tmp, "claude.args"), "utf8")).not.toContain("--resume");
  } finally {
    rmSync(join(tmp, "fail-resume"), { force: true });
  }
});

test("a resumed run that worked and then failed is the draft's failure, measured, and not run again", async () => {
  const first = await toolHarness(() => ({ harness: "claude", model: "opus" }))(draftDir("after-start-1"), "x", new AbortController().signal);
  writeFileSync(join(tmp, "fail-after-start"), "");
  try {
    const r = await toolHarness(() => ({ harness: "claude", model: "opus" }))(draftDir("after-start-2"), "x", new AbortController().signal, () => {}, undefined, first.session);
    expect(r.error).toContain("overloaded");
    expect(r.stats).toMatchObject({ turns: 4, cost: 0.4 });
    expect(r.runs).toBeUndefined();
    expect(readFileSync(join(tmp, "claude.args"), "utf8")).toContain("--resume");
  } finally {
    rmSync(join(tmp, "fail-after-start"), { force: true });
  }
});

test("a conversation OpenCode no longer has, or in a folder that isn't a draft's, starts fresh", async () => {
  const harness = toolHarness(() => ({ harness: "opencode", model: "openai/gpt-6.1-sol" }));
  const first = await harness(draftDir("oc-1"), "x", new AbortController().signal);
  await harness(draftDir("oc-2"), "x", new AbortController().signal, () => {}, undefined, first.session);
  expect(readFileSync(join(tmp, "opencode.args"), "utf8")).toContain("--session");
  writeFileSync(join(tmp, "no-session"), "");
  try {
    const r = await harness(draftDir("oc-3"), "x", new AbortController().signal, () => {}, undefined, first.session);
    expect(r.resumed).toBe(false);
    expect(readFileSync(join(tmp, "opencode.args"), "utf8")).not.toContain("--session");
  } finally {
    rmSync(join(tmp, "no-session"), { force: true });
  }
  const elsewhere = join(tmp, "not-a-draft");
  const r = await harness(draftDir("oc-4"), "x", new AbortController().signal, () => {}, undefined, { ...first.session!, cwd: elsewhere });
  expect(r.resumed).toBe(false);
  expect(existsSync(elsewhere)).toBe(false);
});

test("a session's folder in use by another run is left to it", async () => {
  const harness = toolHarness(() => ({ harness: "claude", model: "opus" }));
  const first = await harness(draftDir("busy-1"), "x", new AbortController().signal);
  mkdirSync(first.session!.cwd);
  writeFileSync(join(first.session!.cwd, "theirs"), "");
  try {
    const r = await harness(draftDir("busy-2"), "x", new AbortController().signal, () => {}, undefined, first.session);
    expect(r.error).toBeUndefined();
    expect(r.resumed).toBe(false);
    expect(existsSync(join(first.session!.cwd, "theirs"))).toBe(true);
  } finally {
    rmSync(first.session!.cwd, { recursive: true, force: true });
  }
});

test("the brief's version changes with the catalog and the theme it shows", async () => {
  const { briefVersion } = await import("../src/server/draft.ts");
  const a = briefVersion({ theme: "paper", catalog: { version: 9 } });
  expect(a).toMatch(/^[0-9a-f]{8}$/);
  expect(briefVersion({ theme: "paper", catalog: { version: 9 } })).toBe(a);
  expect(briefVersion({ theme: "paper", catalog: { version: 10 } })).not.toBe(a);
  expect(briefVersion({ theme: "terminal", catalog: { version: 9 } })).not.toBe(a);
});

test("a draft keeps the drafter it started with, through its second try", async () => {
  let now: Drafter = { harness: "claude", model: "sonnet" };
  const harness = toolHarness(() => now);
  const dir = draftDir("kept-drafter");
  await harness(dir, "x", new AbortController().signal);
  now = { harness: "claude", model: "opus" };
  await harness(dir, "fix it", new AbortController().signal);
  const args = readFileSync(join(tmp, "claude.args"), "utf8").trim().split("\n");
  expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  // Another draft takes the new choice.
  await harness(draftDir("next-drafter"), "x", new AbortController().signal);
  const next = readFileSync(join(tmp, "claude.args"), "utf8").trim().split("\n");
  expect(next[next.indexOf("--model") + 1]).toBe("opus");
});

test("an effort the model doesn't take fails at once; each provider offers its own", async () => {
  expect(await modelProblem({ harness: "claude", model: "opus", effort: "medium" })).toBeUndefined();
  expect(await modelProblem({ harness: "claude", model: "opus", effort: "turbo" })).toBeDefined();
  expect(await modelProblem({ harness: "opencode", model: "anthropic/claude-opus-5-5", effort: "max" })).toBeUndefined();
  expect(await modelProblem({ harness: "opencode", model: "anthropic/claude-opus-5-5", effort: "minimal" })).toBeDefined();
  expect(efforts({ harness: "opencode", model: "openai/gpt-6.1-sol" })).toContain("xhigh");
  expect(efforts({ harness: "opencode", model: "someone/else" })).toEqual([]);
});

test("Claude Code streams its events, and an error it reports at the end fails the draft", async () => {
  expect(command({ harness: "claude" }, "x").args).toContain("stream-json");
  writeFileSync(join(bin, "claude"), `#!/bin/sh
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}' '{"type":"result","is_error":true,"result":"out of credit"}'
`);
  chmodSync(join(bin, "claude"), 0o755);
  const result = await toolHarness(() => ({ harness: "claude" }))(draftDir("claude-error"), "x", new AbortController().signal);
  expect(result.error).toContain("out of credit");
});

test("the log names the files a patch writes", async () => {
  const { readable } = await import("../src/server/harness.ts");
  const said = readable("opencode", JSON.stringify({ type: "tool_use", part: { tool: "patch", state: { input: { patchText: "*** Begin Patch\n*** Add File: /tmp/rubric-draft-x1/part.yaml\n+name: a\n*** Update File: /tmp/rubric-draft-x1/part.css\n*** End Patch" } } } }));
  expect(said).toContain("part.yaml");
  expect(said).toContain("part.css");
  expect(said).not.toContain("/tmp/");
});

test("with no model, each tool uses its own default", () => {
  expect(command({ harness: "opencode" }, "x").args).not.toContain("--model");
  expect(command({ harness: "claude" }, "x").args).not.toContain("--model");
});

test("a folder left by a draft that never finished is cleared once it's older than any draft may take", async () => {
  const old = mkdtempSync(join(tmpdir(), "rubric-draft-"));
  const oldConfig = mkdtempSync(join(tmpdir(), "rubric-opencode-config-"));
  const recent = mkdtempSync(join(tmpdir(), "rubric-draft-"));
  const { utimesSync } = await import("node:fs");
  const past = (Date.now() - 20 * 60_000) / 1000;
  utimesSync(old, past, past);
  utimesSync(oldConfig, past, past);
  await toolHarness(() => ({ harness: "opencode" }))(draftDir("sweep"), "x", new AbortController().signal);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(oldConfig)).toBe(false);
  expect(existsSync(recent)).toBe(true);
  rmSync(recent, { recursive: true, force: true });
});
