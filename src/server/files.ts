// The site's own files, by the address a page uses for them: Hugo serves
// static/images/walk.jpg at /images/walk.jpg. The editor's own path
// completion reads a leading / as the root of the computer, so the server
// offers these instead, and says when an address points at nothing.

import { readdirSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";
import type { Site } from "../site.ts";

const PICTURE = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"]);

// Only addresses at the site's root are checked. A relative address depends on
// the page's own address, and one with a host is someone else's.
export function isSiteAddress(address: string): boolean {
  return address.startsWith("/") && !address.startsWith("//");
}

export function fileExists(site: Site, address: string): boolean {
  let path = address.replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {}
  return site.static.some((dir) => {
    try {
      return statSync(join(dir, path)).isFile();
    } catch {
      return false;
    }
  });
}

// Every picture the site serves, as addresses, sorted. Read on each request:
// a picture added a moment ago should be offered.
export function pictures(site: Site): string[] {
  const out = new Set<string>();
  for (const dir of site.static) {
    let names: string[];
    try {
      names = readdirSync(dir, { recursive: true }) as string[];
    } catch {
      continue;
    }
    for (const name of names) {
      if (PICTURE.has(extname(name).toLowerCase())) out.add(`/${name.split(sep).join("/")}`);
    }
  }
  return [...out].sort();
}
