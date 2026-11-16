// The Hugo every part of Rubric runs: one pinned version, found or fetched
// the same way everywhere.
//
// In order: `RUBRIC_HUGO`, for development; the copy downloaded before, in
// the cache; `hugo` on PATH, only if it is exactly the pinned version; and,
// where a download is allowed, the release itself, checked against its
// SHA-256 written here before it is unpacked.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fromPkg } from "./pkg.ts";

export const HUGO_VERSION = "0.169.0";
const RELEASES = `https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}`;

// The release archive for each platform Rubric runs on, and its SHA-256 from
// the release's checksum file.
export interface Asset {
  file: string;
  sha256: string;
}
export const ASSETS: Record<string, Asset> = {
  // From the release's hugo_0.169.0_checksums.txt.
  "linux-x64": { file: `hugo_${HUGO_VERSION}_linux-amd64.tar.gz`, sha256: "2d2f0bfe357d8cb4cec02f6bb28a3bff34978c8dda44b618029c5eb9d66765a7" },
  "linux-arm64": { file: `hugo_${HUGO_VERSION}_linux-arm64.tar.gz`, sha256: "ddadaaccbf437e3d39c33140b80c2180c4f46d027d16b7716c1282ea2e14e00c" },
  // macOS gets only an installer package (.pkg), one for both chips, which
  // is unpacked here (pkg.ts), never installed.
  "darwin-x64": { file: `hugo_${HUGO_VERSION}_darwin-universal.pkg`, sha256: "9b1170c439b5444e31d4731dd0071fc2b380b8d58050e6cdae80e3e179b4bf52" },
  "darwin-arm64": { file: `hugo_${HUGO_VERSION}_darwin-universal.pkg`, sha256: "9b1170c439b5444e31d4731dd0071fc2b380b8d58050e6cdae80e3e179b4bf52" },
};

export interface HugoOptions {
  env?: Record<string, string | undefined>;
  // Where downloaded copies are kept; `${XDG_CACHE_HOME:-~/.cache}/rubric/hugo`.
  cacheDir?: string;
  // Where releases are fetched from, and what each platform's archive is.
  releases?: string;
  assets?: Record<string, Asset>;
  platform?: string;
}

export function hugoCacheDir(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache"), "rubric", "hugo");
}

function cached(o: HugoOptions): string {
  return join(o.cacheDir ?? hugoCacheDir(o.env ?? process.env), HUGO_VERSION, "hugo");
}

// The version a Hugo binary says it is, asked once per path.
const versions = new Map<string, string | undefined>();
export function hugoVersion(path: string): string | undefined {
  if (!versions.has(path)) {
    let v: string | undefined;
    try {
      const out = Bun.spawnSync([path, "version"], { stdout: "pipe", stderr: "ignore", timeout: 10_000 }).stdout.toString();
      v = /\bv(\d+\.\d+\.\d+)/.exec(out)?.[1];
    } catch {
      v = undefined;
    }
    versions.set(path, v);
  }
  return versions.get(path);
}

// The Hugo to run, without downloading: undefined when there is none yet.
export function hugoPath(o: HugoOptions = {}): string | undefined {
  const env = o.env ?? process.env;
  if (env.RUBRIC_HUGO) return env.RUBRIC_HUGO;
  const copy = cached(o);
  if (existsSync(copy)) return copy;
  const onPath = Bun.which("hugo", env.PATH !== undefined ? { PATH: env.PATH } : undefined);
  if (onPath && hugoVersion(onPath) === HUGO_VERSION) return onPath;
  return undefined;
}

// The Hugo to run, downloading the pinned release once if there is none.
export async function ensureHugo(o: HugoOptions = {}): Promise<{ path: string } | { error: string }> {
  const found = hugoPath(o);
  if (found) return { path: found };
  const platform = o.platform ?? `${process.platform}-${process.arch}`;
  const asset = (o.assets ?? ASSETS)[platform];
  if (!asset) return { error: `Hugo ${HUGO_VERSION} not downloaded: no release for ${platform}` };
  if (!asset.sha256) return { error: `Hugo ${HUGO_VERSION} not downloaded: no checksum for ${platform}` };
  const dest = cached(o);
  const dir = join(dest, "..");
  mkdirSync(dir, { recursive: true });
  const unlock = await lock(join(dir, ".lock"));
  try {
    // Another process may have fetched it while this one waited.
    if (existsSync(dest)) return { path: dest };
    let body: ArrayBuffer;
    try {
      const res = await fetch(`${o.releases ?? RELEASES}/${asset.file}`, { redirect: "follow" });
      if (!res.ok) return { error: `Hugo ${HUGO_VERSION} not downloaded: ${res.status} ${res.statusText}`.trim() };
      body = await res.arrayBuffer();
    } catch {
      return { error: `Hugo ${HUGO_VERSION} not downloaded: offline` };
    }
    const sum = new Bun.CryptoHasher("sha256").update(body).digest("hex");
    if (sum !== asset.sha256) return { error: `Hugo ${HUGO_VERSION} not downloaded: its checksum does not match` };
    const work = join(dir, `.unpack-${process.pid}`);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    try {
      if (asset.file.endsWith(".pkg")) {
        const hugo = fromPkg(new Uint8Array(body), "hugo");
        if (hugo) writeFileSync(join(work, "hugo"), hugo);
      } else {
        writeFileSync(join(work, asset.file), new Uint8Array(body));
        Bun.spawnSync(["tar", "-xzf", join(work, asset.file), "-C", work, "hugo"], { stdout: "ignore", stderr: "pipe" });
      }
      if (!existsSync(join(work, "hugo"))) return { error: `Hugo ${HUGO_VERSION} not downloaded: the archive has no hugo in it` };
      chmodSync(join(work, "hugo"), 0o755);
      renameSync(join(work, "hugo"), dest);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    return { path: dest };
  } finally {
    unlock();
  }
}

// One download at a time across processes: a lock file made exclusively,
// taken over when it is older than the longest a download should take.
async function lock(path: string): Promise<() => void> {
  for (const end = Date.now() + 120_000; ; ) {
    try {
      closeSync(openSync(path, "wx"));
      return () => rmSync(path, { force: true });
    } catch {
      try {
        if (Date.now() - statSync(path).mtimeMs > 300_000) rmSync(path, { force: true });
      } catch {
        // Gone between the two calls: try again.
      }
      if (Date.now() > end) return () => {};
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
