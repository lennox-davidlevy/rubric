// The testing site as the tests know it: only what git tracks in testing/.
// The writer's own live-test work there (parts kept in testing/parts/, their
// pages) is ignored by git and must not change what a test sees: a quote kept
// for the site during a live test made a catalog line read as changed.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const repo = join(import.meta.dir, "..");

export function copyTestingSite(to: string): void {
  const ls = Bun.spawnSync(["git", "ls-files", "-z", "testing"], { cwd: repo });
  if (ls.exitCode !== 0) throw new Error(`git ls-files failed: ${ls.stderr.toString()}`);
  for (const path of ls.stdout.toString().split("\0")) {
    if (!path || /^testing\/(content|\.rubric|public|resources)\//.test(path)) continue;
    const dest = join(to, path.slice("testing/".length));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(repo, path), dest);
  }
}
