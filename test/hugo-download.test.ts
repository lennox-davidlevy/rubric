// The pinned Hugo: found, or fetched once and checked, from a fake release
// served here, with a stand-in `hugo` that only says its version.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { ensureHugo, HUGO_VERSION, hugoPath, type HugoOptions } from "../src/hugo.ts";

const tmp = mkdtempSync(join(tmpdir(), "rubric-hugo-"));
const fakeHugo = (dir: string, version: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hugo"), `#!/bin/sh\necho "hugo v${version}-fake linux/amd64"\n`);
  chmodSync(join(dir, "hugo"), 0o755);
  return join(dir, "hugo");
};

let server: ReturnType<typeof Bun.serve>;
let fetched = 0;
let archive: Uint8Array;
let sha256: string;
const FILE = "hugo_test.tar.gz";
const PKG = "hugo_test.pkg";
let pkg: Uint8Array;

// A macOS installer package as the release makes one: a xar archive whose
// Payload is a gzip'd odc cpio holding ./hugo beside other files.
function makePkg(files: Record<string, Uint8Array>): Uint8Array {
  const octal = (n: number, w: number) => n.toString(8).padStart(w, "0");
  const entry = (name: string, body: Uint8Array, mode: number) => {
    const head = "070707" + octal(0, 6) + octal(0, 6) + octal(mode, 6) + octal(0, 6) + octal(0, 6) + octal(1, 6) + octal(0, 6) + octal(0, 11) + octal(name.length + 1, 6) + octal(body.length, 11);
    return Buffer.concat([Buffer.from(head + name + "\0", "latin1"), body]);
  };
  const cpio = Buffer.concat([
    ...Object.entries(files).map(([n, b]) => entry(n, b, 0o100755)),
    entry("TRAILER!!!", new Uint8Array(), 0),
  ]);
  const payload = Bun.gzipSync(cpio);
  const bom = deflateSync(Buffer.from("bom"));
  const toc = `<?xml version="1.0"?><xar><toc><file id="1"><data><length>${bom.length}</length><offset>0</offset><encoding style="application/x-gzip"/></data><name>Bom</name></file><file id="2"><data><length>${payload.length}</length><encoding style="application/octet-stream"/><offset>${bom.length}</offset></data><ea><offset>0</offset><length>1</length><name>com.apple.provenance</name></ea><name>Payload</name></file></toc></xar>`;
  const z = deflateSync(Buffer.from(toc));
  const header = Buffer.alloc(28);
  header.write("xar!", 0, "latin1");
  header.writeUInt16BE(28, 4);
  header.writeUInt16BE(1, 6);
  header.writeBigUInt64BE(BigInt(z.length), 8);
  header.writeBigUInt64BE(BigInt(toc.length), 16);
  header.writeUInt32BE(1, 24);
  return new Uint8Array(Buffer.concat([header, z, bom, payload]));
}

beforeAll(() => {
  const src = join(tmp, "release");
  fakeHugo(src, HUGO_VERSION);
  writeFileSync(join(src, "LICENSE"), "not hugo\n");
  expect(Bun.spawnSync(["tar", "-czf", join(tmp, FILE), "-C", src, "hugo", "LICENSE"]).exitCode).toBe(0);
  archive = new Uint8Array(readFileSync(join(tmp, FILE)));
  sha256 = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  pkg = makePkg({ "./._hugo": new Uint8Array([1, 2, 3]), "./hugo": new Uint8Array(readFileSync(join(src, "hugo"))) });
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      fetched++;
      // Slow enough that two callers overlap.
      await Bun.sleep(50);
      const path = new URL(req.url).pathname;
      return path === `/${FILE}` ? new Response(archive) : path === `/${PKG}` ? new Response(pkg) : new Response("no", { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

let n = 0;
// Options for a clean machine: an empty cache and a PATH with no Hugo on it.
const fresh = (over: Partial<HugoOptions> = {}): HugoOptions => {
  const at = join(tmp, `case-${++n}`);
  mkdirSync(join(at, "bin"), { recursive: true });
  return {
    env: { PATH: join(at, "bin"), HOME: at },
    cacheDir: join(at, "cache"),
    releases: `http://127.0.0.1:${server.port}`,
    assets: { here: { file: FILE, sha256 } },
    platform: "here",
    ...over,
  };
};

describe("the pinned Hugo", () => {
  test("RUBRIC_HUGO wins over everything", () => {
    const o = fresh();
    fakeHugo(join(o.env!.HOME!, "bin"), HUGO_VERSION);
    expect(hugoPath({ ...o, env: { ...o.env, RUBRIC_HUGO: "/opt/my/hugo" } })).toBe("/opt/my/hugo");
  });

  test("hugo on PATH is used only when it is the pinned version", () => {
    const right = fresh();
    expect(hugoPath(right)).toBeUndefined();
    const path = fakeHugo(join(right.env!.HOME!, "bin"), HUGO_VERSION);
    expect(hugoPath(right)).toBe(path);
    const wrong = fresh();
    fakeHugo(join(wrong.env!.HOME!, "bin"), "0.150.0");
    expect(hugoPath(wrong)).toBeUndefined();
  });

  test("a download is checked, unpacked to the cache, and reused without fetching again", async () => {
    const o = fresh();
    const before = fetched;
    const got = await ensureHugo(o);
    expect(got).toEqual({ path: join(o.cacheDir!, HUGO_VERSION, "hugo") });
    expect(Bun.spawnSync([(got as { path: string }).path, "version"]).stdout.toString()).toContain(HUGO_VERSION);
    // Only the binary is kept, and nothing half-done is left beside it.
    expect(existsSync(join(o.cacheDir!, HUGO_VERSION, "LICENSE"))).toBe(false);
    expect(await ensureHugo(o)).toEqual(got);
    expect(hugoPath(o)).toBe((got as { path: string }).path);
    expect(fetched - before).toBe(1);
  });

  test("macOS's installer package is unpacked for its hugo alone, never installed", async () => {
    const o = fresh({ assets: { here: { file: PKG, sha256: new Bun.CryptoHasher("sha256").update(pkg).digest("hex") } } });
    const got = await ensureHugo(o);
    expect(got).toEqual({ path: join(o.cacheDir!, HUGO_VERSION, "hugo") });
    expect(Bun.spawnSync([(got as { path: string }).path, "version"]).stdout.toString()).toContain(HUGO_VERSION);
  });

  test("a package with no hugo in it is an error, and nothing is kept", async () => {
    const empty = makePkg({ "./README": new Uint8Array([1]) });
    const o = fresh({ assets: { here: { file: PKG, sha256: new Bun.CryptoHasher("sha256").update(empty).digest("hex") } } });
    pkg = empty;
    try {
      expect(await ensureHugo(o)).toMatchObject({ error: expect.stringContaining("no hugo") });
      expect(hugoPath(o)).toBeUndefined();
    } finally {
      pkg = makePkg({ "./hugo": new Uint8Array(readFileSync(join(tmp, "release", "hugo"))) });
    }
  });

  test("two at once fetch it once", async () => {
    const o = fresh();
    const before = fetched;
    const [a, b] = await Promise.all([ensureHugo(o), ensureHugo(o)]);
    expect(a).toEqual(b);
    expect("path" in a).toBe(true);
    expect(fetched - before).toBe(1);
  });

  test("an archive whose checksum does not match is refused and nothing is kept", async () => {
    const o = fresh({ assets: { here: { file: FILE, sha256: "0".repeat(64) } } });
    expect("error" in (await ensureHugo(o))).toBe(true);
    expect(hugoPath(o)).toBeUndefined();
  });

  test("offline, or a platform with no release or checksum, is an error, not a crash", async () => {
    const offline = fresh({ releases: "http://127.0.0.1:9" });
    expect(await ensureHugo(offline)).toMatchObject({ error: expect.stringContaining("offline") });
    expect("error" in (await ensureHugo(fresh({ platform: "plan9-mips" })))).toBe(true);
    expect("error" in (await ensureHugo(fresh({ assets: { here: { file: FILE, sha256: "" } } })))).toBe(true);
  });
});
