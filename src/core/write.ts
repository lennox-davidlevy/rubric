// Writes a file whole, one write at a time per path, newest last. A reader
// such as Hugo's watcher never sees half a file, and an older write that is
// slow to finish never lands after a newer one.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const queues = new Map<string, Promise<void>>();
const latest = new Map<string, string>();
let n = 0;

// `tmpDir` holds the file until it is renamed into place, and must be on the
// same filesystem. Keep it out of folders a watcher reads.
export function writeWhole(path: string, data: string, tmpDir = dirname(path)): Promise<void> {
  latest.set(path, data);
  const run = (queues.get(path) ?? Promise.resolve()).then(async () => {
    // A later call may have queued newer data; this run writes whatever is
    // newest, and the runs after it find nothing left to write.
    const next = latest.get(path);
    if (next === undefined) return;
    latest.delete(path);
    await mkdir(dirname(path), { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, `${basename(path)}.${process.pid}.${++n}.tmp`);
    await writeFile(tmp, next);
    await rename(tmp, path);
  });
  queues.set(path, run.catch(() => {}));
  return run;
}
