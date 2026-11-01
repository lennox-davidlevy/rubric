// Reproduces the live-test problem: types blocks into the playground through
// the user's real Neovim config, slowly, with pauses in the middle of lines so
// the ghost text comes up for a half-typed line, and compares the buffer with
// the server's text (RUBRIC_TRACE), content/, and what Hugo serves.
//
//   bun scripts/live-repro.ts [blocks] [msPerKey]
//
// Needs `bun run play` (Hugo on 1415, or RUBRIC_PORT). Restores the page afterwards.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const site = join(repo, "testing");
const page = join(site, "pages/posts/playground.md");
const content = join(site, "content/posts/playground.md");
const blocks = Number(process.argv[2] ?? 4);
const perKey = Number(process.argv[3] ?? 120);
const dir = mkdtempSync(join(tmpdir(), "rubric-live-"));
const sock = join(dir, "nvim.sock");
const trace = join(dir, "trace.jsonl");
copyFileSync(page, join(dir, "page.bak"));

const editor = Bun.spawn(["nvim", "--headless", "--listen", sock, page], {
  cwd: site, env: { ...process.env, RUBRIC_TRACE: trace }, stdout: "ignore", stderr: "ignore",
});
const send = (k: string) => Bun.spawnSync(["nvim", "--server", sock, "--remote-send", k]);
const expr = (e: string) => Bun.spawnSync(["nvim", "--server", sock, "--remote-expr", e]).stdout.toString();
// Types text a key at a time; "|" is a pause long enough for Jev to be asked.
const type = async (s: string) => {
  for (const ch of s) {
    if (ch === "|") { await Bun.sleep(1800); continue; }
    send(ch === " " ? "<Space>" : ch === "\n" ? "<CR>" : ch);
    await Bun.sleep(perKey);
  }
};
// What Hugo serves, and whether a browser could keep an older copy. Hugo's
// dev server dates pages to the second, so when two builds land in the same
// second a reloading browser asks If-Modified-Since, gets 304, and keeps the
// older page: the "Hello wor" preview. The site's no-store header stops the
// browser asking. A race that needs two builds in one second is rarely caught
// by sampling, so the header itself is checked.
const served = async () => {
  const res = await fetch(`http://localhost:${process.env.RUBRIC_PORT ?? 1415}/posts/playground/`);
  const text = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return { text, stale: !/no-store/.test(res.headers.get("cache-control") ?? "") };
};
const serverText = () => {
  const l = readFileSync(trace, "utf8").trim().split("\n");
  return JSON.parse(l[l.length - 1]!).text as string;
};
// content/ must match the buffer line for line, except that a directive line
// may have become a shortcode.
const contentMatches = (buf: string, file: string) => {
  const a = buf.split("\n"), b = file.split("\n");
  if (a.length !== b.length) return `line count ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i]!.startsWith(":::") && b[i]!.startsWith("{{<")) continue;
    return `line ${i + 1}: buffer ${JSON.stringify(a[i])} content ${JSON.stringify(b[i])}`;
  }
  return "";
};

const lines = [
  ["a big pull quo|te in the middle of the pa|ge", "Hello wor|ld"],
  ["a short no|te for the reader", "Hello per|son"],
  ["a big quo|te", "Hello world aga|in"],
  ["a box with a stro|ng shadow", "Inside the b|ox"],
  ["a warn|ing before the next step", "Mind the g|ap"],
  ["a quote from a po|et, centered", "The woods are lov|ely"],
];

let failures = 0;
const check = async (label: string, body?: string) => {
  await Bun.sleep(2500);
  // getline() has no trailing newline; the file and the server's text do.
  const buf = expr('join(getline(1, "$"), "\\n")');
  const server = serverText().replace(/\n$/, "");
  const file = readFileSync(content, "utf8").replace(/\n$/, "");
  const { text: html, stale } = await served();
  const problems = [];
  if (server !== buf) problems.push(`server text differs from buffer: ${contentMatches(buf, server)}`);
  const c = contentMatches(buf, file);
  if (c) problems.push(`content/ differs: ${c}`);
  if (body && !html.includes(body)) problems.push(`hugo lacks "${body}"`);
  if (stale) problems.push("no Cache-Control: no-store, so a browser can keep an older page (see testing/hugo.toml)");
  if (problems.length) failures++;
  console.log(`${problems.length ? "FAIL" : "ok  "} ${label}${problems.map((p) => `\n       ${p}`).join("")}`);
};

try {
  await Bun.sleep(5000);
  console.log("attached:", expr('luaeval("#vim.lsp.get_clients({bufnr=0, name=\\"rubric\\"})")').trim(), "| ms per key:", perKey);
  for (let i = 0; i < blocks; i++) {
    const [words, body] = lines[i % lines.length]!;
    send("Go");
    await type(`::: ${words}`);
    await check(`block ${i} opener`);
    send("<M-l>");
    await Bun.sleep(400);
    console.log(`     pinned: ${expr('getline(".")').trim()}`);
    await type(`\n${body}`);
    send("<Esc>");
    await check(`block ${i} body`, body.replace("|", ""));
  }
  // RUBRIC_HOLD=<ms> keeps the typed page in place, for a look at a browser.
  if (process.env.RUBRIC_HOLD) {
    console.log("holding; last buffer lines:\n" + expr('join(getline(line("$")-8, "$"), "\\n")'));
    await Bun.sleep(Number(process.env.RUBRIC_HOLD));
  }
} finally {
  send("<Esc>:qa!<CR>");
  await Promise.race([editor.exited, Bun.sleep(2000)]);
  editor.kill();
  copyFileSync(join(dir, "page.bak"), page);
  if (failures) copyFileSync(trace, join(repo, "testing/.rubric/last-trace.jsonl"));
  rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `${failures} failure(s); trace kept at testing/.rubric/last-trace.jsonl` : "no failures");
}
