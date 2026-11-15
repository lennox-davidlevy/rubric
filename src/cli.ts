#!/usr/bin/env bun
// The rubric command.
//
//   rubric [site]              the site's process here: the page, and editors attach to it
//   rubric new <folder>        a new site: a title, one post, nothing else
//   rubric build [site]        the finished site in public/, with the pinned Hugo
//   rubric stop [site]         stops the site's process, Hugo with it
//   rubric calls [site]        every call to Jev as it happens, and a sum at the end
//   rubric lsp [--stub] [--harness claude|opencode] [--model <model>] [--effort <level>] [--drafting fast|tools]
//                              for editors: their stdio to the site's process,
//                              started in the background when none is running
//
// `site` is the folder holding rubric.md at or above the current one, unless
// named. build uses the cache only: words lines not cached yet stay as text
// until an editor with the server open resolves them.

import { realpathSync } from "node:fs";
import { join } from "node:path";
import { buildSite } from "./build.ts";
import { calls } from "./calls.ts";
import { newSite } from "./new-site.ts";
import { HARNESSES, MODES, type Drafter, type HarnessName, type Mode } from "./server/harness.ts";
import { bridge } from "./server/bridge.ts";
import { alive, running, runSite } from "./server/site-process.ts";
import { findSiteRoot, openSite } from "./site.ts";

const USAGE = "usage: rubric [site] | new <folder> | build [site] | stop [site] | calls [site] | lsp [--stub]";
const [command, ...args] = process.argv.slice(2);

// The site named, or the one the current folder is in.
function siteRoot(named: string | undefined): string {
  const root = findSiteRoot(named ?? process.cwd());
  if (!root) {
    console.error(`${named ?? process.cwd()} is not in a Rubric site: no rubric.md`);
    process.exit(1);
  }
  return root;
}

// The drafter and drafting mode named on a command line, whole: what isn't
// given is the tool's default, not the built-in drafter's.
function drafterFlags(argv: string[]): { drafter?: Drafter; mode?: Mode } {
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const harness = flag("--harness");
  const model = flag("--model");
  const effort = flag("--effort");
  if (harness !== undefined && !HARNESSES.includes(harness as HarnessName)) {
    console.error(`--harness is one of ${HARNESSES.join(", ")}`);
    process.exit(2);
  }
  const drafting = flag("--drafting");
  if (drafting !== undefined && !MODES.includes(drafting as Mode)) {
    console.error(`--drafting is one of ${MODES.join(", ")}`);
    process.exit(2);
  }
  const named = harness !== undefined || model !== undefined || effort !== undefined;
  return {
    ...(named ? { drafter: { harness: (harness as HarnessName | undefined) ?? "claude", ...(model ? { model } : {}), ...(effort ? { effort } : {}) } } : {}),
    ...(drafting ? { mode: drafting as Mode } : {}),
  };
}

if (command === "lsp") {
  drafterFlags(args);
  await bridge({ stub: args.includes("--stub"), args: args.filter((a) => a !== "--stub") });
} else if (command === "new") {
  if (!args[0]) {
    console.error(USAGE);
    process.exit(2);
  }
  const made = newSite(args[0]);
  if ("error" in made) {
    console.error(made.error);
    process.exit(1);
  }
  console.log(made.root);
} else if (command === "build") {
  const built = await buildSite(await openSite(siteRoot(args[0])));
  if ("error" in built) {
    console.error(built.error);
    process.exit(1);
  }
  console.log(built.public);
} else if (command === "calls") {
  calls(siteRoot(args[0]));
} else if (command === "stop") {
  const root = siteRoot(args[0]);
  // Only a process that answers on the site's socket: a pid left by one that
  // crashed may be another program's by now.
  const s = await running(root);
  if (!s?.pid) {
    console.log("not running");
  } else {
    process.kill(s.pid, "SIGTERM");
    for (const end = Date.now() + 10_000; alive(s.pid) && Date.now() < end; ) await Bun.sleep(50);
    console.log(alive(s.pid) ? `still running: ${s.pid}` : "stopped");
  }
} else if (command === undefined || !command.startsWith("-") && !["help", "--help"].includes(command)) {
  // `rubric [site]`: the site's process, here in the terminal, or where the
  // one already running serves the page.
  const root = siteRoot(command);
  const flags = args.filter((a) => a.startsWith("--") || args[args.indexOf(a) - 1]?.startsWith("--"));
  const background = flags.includes("--background");
  const stub = flags.includes("--stub");
  const there = await running(root);
  if (there) {
    console.log(`http://127.0.0.1:${there.port}/`);
    process.exit(0);
  }
  // Bun finds the key in the repo's .env, so the process runs from there.
  // Real paths: `rubric` is reached through a link.
  const repo = realpathSync(join(import.meta.dir, ".."));
  if (realpathSync(process.cwd()) !== repo) {
    const child = Bun.spawn(["bun", import.meta.path, root, ...flags], { cwd: repo, stdio: ["inherit", "inherit", "inherit"] });
    // Ctrl-C reaches the child too; this one waits for it.
    process.on("SIGINT", () => {});
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    process.exit(await child.exited);
  }
  const say = (line: string) => console.log(line);
  const site = await runSite(root, {
    stub,
    ...drafterFlags(flags),
    // Started by an editor, it stops a while after the last one leaves;
    // started here, when this terminal says so.
    ...(background ? { idleMs: Number(process.env.RUBRIC_IDLE_MS ?? 60_000) } : {}),
    // In front, only what goes wrong: Hugo's own lines are many.
    say: background ? say : (line) => {
      if (/ERROR|stopped|not downloaded/.test(line)) console.log(line);
    },
  });
  console.log(site.url ?? site.problem);
  const stop = () => void site.stop();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await site.done;
  process.exit(0);
} else {
  console.error(USAGE);
  process.exit(2);
}
