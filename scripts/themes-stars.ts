// Adds GitHub stars and the license GitHub detects to reference/hugo-themes/themes.json,
// through `gh api graphql`, fifty repos to a query.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const file = join(import.meta.dir, "../reference/hugo-themes/themes.json");
const themes = JSON.parse(readFileSync(file, "utf8")) as { url: string; stars?: number; license?: string }[];
const gh = themes.filter((t) => t.url.startsWith("https://github.com/"));
for (let i = 0; i < gh.length; i += 50) {
  const batch = gh.slice(i, i + 50);
  const q = batch.map((t, j) => { const [, , , o, n] = t.url.split("/"); return `r${j}: repository(owner: ${JSON.stringify(o)}, name: ${JSON.stringify(n)}) { stargazerCount licenseInfo { spdxId } }`; }).join("\n");
  const p = Bun.spawnSync(["gh", "api", "graphql", "-f", `query={ ${q} }`]);
  const data = JSON.parse(p.stdout.toString() || "{}").data ?? {};
  batch.forEach((t, j) => { const r = data[`r${j}`]; if (r) { t.stars = r.stargazerCount; t.license = r.licenseInfo?.spdxId; } });
}
writeFileSync(file, JSON.stringify(themes, null, 2));
console.log(`${themes.filter((t) => t.stars !== undefined).length} of ${themes.length} with stars`);
