// Fetches every theme listed on themes.gohugo.io into reference/hugo-themes/,
// shallow and sparse: layouts, theme metadata, config and license only, no
// pictures or demo sites. Research for the universal catalog; see
// scripts/themes-count.ts.
//
//   bun scripts/themes-fetch.ts [parallel]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const out = join(repo, "reference/hugo-themes");
const parallel = Number(process.argv[2] ?? 16);
mkdirSync(out, { recursive: true });

const list = await (await fetch("https://raw.githubusercontent.com/gohugoio/hugoThemesSiteBuilder/main/themes.txt")).text();
// A module path is host/owner/repo, then maybe a major version (/v2) or a
// folder inside the repo (/modules/blox-tailwind).
const themes = list.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((path) => {
  const [host, owner, name, ...rest] = path.split("/");
  const sub = rest.filter((p) => !/^v\d+$/.test(p)).join("/");
  return { path, url: `https://${host}/${owner}/${name}`, dir: join(out, `${host}_${owner}_${name}${sub ? "_" + sub.replace(/\//g, "_") : ""}`), sub };
});
writeFileSync(join(out, "themes.json"), JSON.stringify(themes, null, 2));

const sh = async (cmd: string[], cwd?: string) => {
  const p = Bun.spawn(cmd, { cwd, stdout: "ignore", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const code = await p.exited;
  return { code, err: code ? (await new Response(p.stderr).text()).trim().split("\n").pop() : "" };
};

let done = 0, failed = 0;
const fetchOne = async (t: (typeof themes)[number]) => {
  if (existsSync(join(t.dir, ".git"))) return void done++;
  const pre = t.sub ? `${t.sub}/` : "";
  let r = await sh(["git", "clone", "--quiet", "--depth", "1", "--filter=blob:none", "--no-checkout", t.url, t.dir]);
  if (!r.code) r = await sh(["git", "sparse-checkout", "set", "--no-cone", `/${pre}layouts/`, `/${pre}theme.toml`, `/${pre}LICENSE*`, `/${pre}LICENCE*`, `/${pre}license*`, `/${pre}COPYING*`, `/${pre}hugo.*`, `/${pre}config.*`, `/${pre}package.json`], t.dir);
  if (!r.code) r = await sh(["git", "checkout", "--quiet"], t.dir);
  done++;
  if (r.code) { failed++; console.log(`failed ${t.path}: ${r.err}`); }
  if (done % 50 === 0) console.log(`${done}/${themes.length}`);
};

const queue = [...themes];
await Promise.all(Array.from({ length: parallel }, async () => { for (let t; (t = queue.shift()); ) await fetchOne(t); }));
console.log(`${themes.length} themes, ${failed} failed, in ${out}`);
