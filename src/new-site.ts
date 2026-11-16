// `rubric new <folder>`: a site with nothing in it but a title and one post.
// What Hugo needs besides is Rubric's to write (src/hugo-config.ts), so the
// site holds only the writer's own files.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// "my-garden" -> "My Garden".
export function titleOf(folder: string): string {
  const words = basename(resolve(folder)).split(/[-_\s]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") : "A New Site";
}

export function newSite(folder: string, today = new Date()): { root: string } | { error: string } {
  const root = resolve(folder);
  if (existsSync(root) && readdirSync(root).length > 0) return { error: `${root} is not empty` };
  const title = titleOf(root);
  const date = today.toISOString().slice(0, 10);
  const files: Record<string, string> = {
    "rubric.md": "",
    "hugo.toml": `baseURL = "/"\ntitle = ${JSON.stringify(title)}\n\n[params]\n`,
    "pages/_index.md": `---\ntitle: ${JSON.stringify(title)}\n---\n`,
    "pages/posts/first.md": `---\ntitle: "The first post"\ndate: ${date}\n---\n`,
    ".gitignore": "content/\npublic/\n.rubric/\nresources/_gen/\n.hugo_build.lock\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root };
}
