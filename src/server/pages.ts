// A site's pages, read fresh on each `rubric/pages` request (keeping nothing):
// every `.md` under `pages/`, taking an open document's unsaved editor text
// when open and reading the file otherwise.

import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { lines as splitLines } from "../core/scan.ts";
import { pageKind, type Site } from "../site.ts";

export interface SitePage {
  uri: string;
  kind: "home" | "page" | "post";
  title: string;
  date?: string;
  draft: boolean;
}

export interface SitePages {
  site: string;
  pages: SitePage[];
}

// Lists every `.md` under `site.pages`: home first, then pages by title, then
// posts newest first by date with undated posts last by title. `site` is the
// home page's title (when it has a front matter title or heading) or the site
// folder's name.
export async function listSitePages(
  site: Site,
  openText: (file: string) => string | undefined,
): Promise<SitePages> {
  const entries = (await readdir(site.pages, { recursive: true }).catch(() => [] as string[]))
    .filter((rel) => rel.endsWith(".md"));

  const pages: SitePage[] = [];
  let siteTitle: string | undefined;

  for (const rel of entries) {
    const full = resolve(join(site.pages, rel));
    const kind = pageKind(rel);
    if (kind === "site") continue;
    let text = openText(full);
    if (text === undefined) {
      try {
        text = await readFile(full, "utf8");
      } catch {
        continue;
      }
    }
    const meta = parsePageMeta(full, text);
    if (kind === "home" && meta.fromContent) {
      siteTitle = meta.title;
    }
    pages.push({
      uri: pathToFileURL(full).href,
      kind,
      title: meta.title,
      ...(meta.date ? { date: meta.date } : {}),
      draft: meta.draft,
    });
  }

  pages.sort(comparePages);
  return {
    site: siteTitle || basename(site.root),
    pages,
  };
}

interface PageMeta {
  title: string;
  // True when `title` came from front matter or a heading (not the file name fallback).
  fromContent: boolean;
  date?: string;
  draft: boolean;
}

// Sitting 1's title rule: front matter `title`, else the first ATX heading
// outside front matter and code fences, else the file's name. Front matter
// that does not parse gives the file's name and no date.
export function parsePageMeta(file: string, text: string): PageMeta {
  const fallback = basename(file);
  const src = splitLines(text);
  const delim = src[0]?.trimEnd();
  let bodyStart = 0;
  let fmTitle: string | undefined;
  let date: string | undefined;
  let draft = false;

  if (delim === "---" || delim === "+++") {
    let end = -1;
    for (let i = 1; i < src.length; i++) {
      const trimmed = src[i]!.trimEnd();
      if (trimmed === delim || (delim === "---" && trimmed === "...")) {
        end = i;
        break;
      }
    }
    if (end === -1) {
      return { title: fallback, fromContent: false, draft: false };
    }
    bodyStart = end + 1;
    const raw = src.slice(1, end).join("\n");
    let data: unknown;
    try {
      data = delim === "---" ? parse(raw) : Bun.TOML.parse(raw);
      if (data !== null && data !== undefined && (typeof data !== "object" || Array.isArray(data))) {
        return { title: fallback, fromContent: false, draft: false };
      }
    } catch {
      return { title: fallback, fromContent: false, draft: false };
    }
    if (data && typeof data === "object") {
      const rec = data as Record<string, unknown>;
      if (typeof rec.title === "string" && rec.title.trim()) {
        fmTitle = rec.title.trim();
      }
      date = formatDate(rec.date);
      draft = rec.draft === true;
    }
  }

  if (fmTitle) {
    return { title: fmTitle, fromContent: true, ...(date ? { date } : {}), draft };
  }

  const heading = firstHeading(src, bodyStart);
  if (heading) {
    return { title: heading, fromContent: true, ...(date ? { date } : {}), draft };
  }
  return { title: fallback, fromContent: false, ...(date ? { date } : {}), draft };
}

function formatDate(v: unknown): string | undefined {
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
    return m ? m[1] : undefined;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return undefined;
}

function firstHeading(src: string[], from: number): string | undefined {
  let fence = false;
  for (let i = from; i < src.length; i++) {
    const t = src[i]!.trimStart();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    let n = 0;
    while (n < t.length && t[n] === "#") n++;
    if (n >= 1 && n <= 6 && (t[n] === " " || t[n] === "\t")) {
      const words = t.slice(n).trim().replace(/#+$/, "").trim();
      if (words) return words;
    }
  }
  return undefined;
}

const KIND_ORDER: Record<SitePage["kind"], number> = { home: 0, page: 1, post: 2 };

function comparePages(a: SitePage, b: SitePage): number {
  const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (ko !== 0) return ko;
  if (a.kind === "post") {
    if (a.date && b.date && a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
  }
  return a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.uri.localeCompare(b.uri);
}
