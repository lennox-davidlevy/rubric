// One file out of a macOS installer package (.pkg), without installing it
// and without macOS tools, so a Mac gets Hugo the same way Linux does and
// the code is tested on either.
//
// A flat package is a xar archive: a 28-byte header, a zlib-compressed XML
// table of contents, then the heap its files point into. The files are in
// `Payload`, a gzip'd cpio archive in the portable (odc) format.

import { inflateSync } from "node:zlib";

export function fromPkg(pkg: Uint8Array, want: string): Uint8Array | undefined {
  const b = Buffer.from(pkg.buffer, pkg.byteOffset, pkg.byteLength);
  if (b.length < 28 || b.toString("latin1", 0, 4) !== "xar!") return undefined;
  const headerSize = b.readUInt16BE(4);
  const tocLength = Number(b.readBigUInt64BE(8));
  const heap = headerSize + tocLength;
  let toc: string;
  try {
    toc = inflateSync(b.subarray(headerSize, heap)).toString("utf8");
  } catch {
    return undefined;
  }
  // The Payload's own <data>, not that of an attribute (<ea>) inside it.
  const named = toc.indexOf("<name>Payload</name>");
  if (named < 0) return undefined;
  const entry = toc.slice(toc.lastIndexOf("<file", named), named);
  const data = /<data>([\s\S]*?)<\/data>/.exec(entry)?.[1];
  if (!data) return undefined;
  const offset = Number(/<offset>(\d+)<\/offset>/.exec(data)?.[1]);
  const length = Number(/<length>(\d+)<\/length>/.exec(data)?.[1]);
  const encoding = /<encoding style="([^"]+)"/.exec(data)?.[1];
  if (!Number.isFinite(offset) || !Number.isFinite(length) || heap + offset + length > b.length) return undefined;
  let payload = b.subarray(heap + offset, heap + offset + length);
  try {
    if (encoding === "application/x-gzip") payload = Buffer.from(inflateSync(payload));
    // The Payload itself is gzip'd inside its heap entry.
    if (payload[0] === 0x1f && payload[1] === 0x8b) payload = Buffer.from(Bun.gunzipSync(new Uint8Array(payload)));
  } catch {
    return undefined;
  }
  return fromCpio(payload, want);
}

// A file from an odc cpio archive: a 76-byte header of octal fields per
// entry, then its name (with a NUL), then its bytes.
function fromCpio(c: Buffer, want: string): Uint8Array | undefined {
  for (let at = 0; at + 76 <= c.length; ) {
    if (c.toString("latin1", at, at + 6) !== "070707") return undefined;
    const octal = (o: number, n: number) => parseInt(c.toString("latin1", at + o, at + o + n), 8);
    const nameSize = octal(59, 6), fileSize = octal(65, 11);
    if (!(nameSize >= 1 && fileSize >= 0)) return undefined;
    const name = c.toString("latin1", at + 76, at + 76 + nameSize - 1);
    if (name === "TRAILER!!!") return undefined;
    const start = at + 76 + nameSize;
    if (name.replace(/^\.\//, "") === want) return start + fileSize <= c.length ? c.subarray(start, start + fileSize) : undefined;
    at = start + fileSize;
  }
  return undefined;
}
