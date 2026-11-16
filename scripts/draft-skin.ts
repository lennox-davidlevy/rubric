// The paid second step of a theme from a site (docs/plan.md, "Before the
// app", 5), as a trial: the step 7 drafter writes a skin, the theme's own
// CSS layer, from pictures of the site and the pieces measure-site.ts read
// from it. Then check and look refuse it or draw it, and the drawing is put
// beside the site. Nothing in Rubric calls this yet.
//
//   bun scripts/measure-site.ts <post url> <name>     first, free
//   bun scripts/draft-skin.ts <name> [model] [effort] paid: about a dollar
//   FIX=1 bun scripts/draft-skin.ts <name>            only fix rounds on the kept skin
//
// It works in measure/catalog/, the copy of the universal catalog that holds
// the measured themes (theme `m-<name>`), and never in catalogs/. The
// drafter runs as a part's draft does (src/server/harness.ts: its own
// folder, read and write only, none of the writer's setup) and writes the
// skin as part.css, the one name the harness copies back that fits.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hugoPath } from "../src/hugo.ts";
import { toolHarness, type Drafter } from "../src/server/harness.ts";

const root = join(import.meta.dir, "..");
const [name, model = "opus", effort = "medium"] = process.argv.slice(2);
if (!name) throw new Error("usage: bun scripts/draft-skin.ts <name> [model] [effort]");
const measured = join(root, "measure", name);
const catalog = join(root, "measure", "catalog");
const theme = `m-${name}`;
const skin = theme;
if (!existsSync(join(measured, "desktop.png"))) throw new Error(`measure ${name} first: bun scripts/measure-site.ts <url> ${name}`);
if (!existsSync(join(catalog, "shots", theme, "stress-1280.png"))) throw new Error(`draw ${theme} first: RUBRIC_CATALOG=../measure/catalog bun scripts/theme.ts look ${theme}`);

const sh = (args: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawnSync(args, { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};

// The folder the drafter works in: the brief, pictures and files to read.
const dir = mkdtempSync(join(tmpdir(), "rubric-skin-"));
// Gone however the script ends, a thrown error included.
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

// The theme's entry in the trial catalog's themes.yaml: its lines, from its
// name to the next unindented line. Its skin is set or taken off there.
const themesFile = join(catalog, "themes.yaml");
const entry = (text: string) => {
  const at = text.indexOf(`\n${theme}:\n`);
  if (at < 0) throw new Error(`no ${theme} in measure/catalog/themes.yaml`);
  const next = text.slice(at + 1).search(/\n(?! )/);
  return { start: at + 1, end: next < 0 ? text.length : at + 1 + next + 1 };
};
const setSkin = (on: boolean) => {
  const text = readFileSync(themesFile, "utf8");
  const { start, end } = entry(text);
  const block = text.slice(start, end).replace(/^  skin: .*\n/m, "") + (on ? `  skin: ${skin}\n` : "");
  writeFileSync(themesFile, text.slice(0, start) + block + text.slice(end));
};
const hasSkin = () => { const t = readFileSync(themesFile, "utf8"); const { start, end } = entry(t); return /^  skin: /m.test(t.slice(start, end)); };

const crop = (src: string, dst: string, w: number, h: number) => {
  const r = sh(["python3", "-c", `from PIL import Image; Image.open(${JSON.stringify(src)}).convert("RGB").crop((0,0,${w},${h})).save(${JSON.stringify(dst)})`]);
  if (r.code !== 0) throw new Error(`could not crop ${src}: ${r.out.trim().split("\n").at(-1)}`);
};
// A first draft or a reroll is shown the page with no skin: a skin kept
// from an earlier run is taken off and the page drawn again first.
if (!process.env.FIX && hasSkin()) {
  setSkin(false);
  const redraw = sh(["bun", "scripts/theme.ts", "look", theme], { RUBRIC_CATALOG: "../measure/catalog" });
  if (!existsSync(join(catalog, "shots", theme, "stress-1280.png"))) throw new Error(`could not draw ${theme} without its skin: ${redraw.out.slice(-500)}`);
}
crop(join(measured, "desktop.png"), join(dir, "site-desktop.png"), 1280, 900);
crop(join(measured, "phone.png"), join(dir, "site-phone.png"), 390, 900);
crop(join(catalog, "shots", theme, "stress-1280.png"), join(dir, "now-desktop.png"), 1280, 1800);
crop(join(catalog, "shots", theme, "stress-360.png"), join(dir, "now-phone.png"), 360, 1400);
for (const k of ["palettes", "pairings", "scales"]) cpSync(join(measured, "themes", k, `${name}.yaml`), join(dir, `${k.slice(0, -1)}.yaml`));
cpSync(join(catalog, "assets/css/base.css"), join(dir, "base.css"));
for (const p of ["header", "footer", "post-meta", "breadcrumbs", "quote", "callout", "code", "table"]) cpSync(join(catalog, `assets/css/parts/${p}.css`), join(dir, `part-${p}.css`));
cpSync(join(catalog, "assets/css/skins/schematic.css"), join(dir, "example-skin-schematic.css"));
// The stress page as it is drawn now, in the measured theme with no skin.
const built = mkdtempSync(join(tmpdir(), "rubric-skin-built-"));
try {
  const hugo = sh([hugoPath() ?? "hugo", "-s", join(catalog, "page"), "-d", built, "--quiet"]);
  if (hugo.code !== 0) throw new Error(`hugo: ${hugo.out}`);
  const html = readFileSync(join(built, "stress", theme, "index.html"), "utf8").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>");
  writeFileSync(join(dir, "page.html"), html.slice(0, 60_000));
} finally {
  rmSync(built, { recursive: true, force: true });
}
const slots = (readFileSync(join(catalog, "catalog.yaml"), "utf8").match(/^slots:\s*\n?\s*\[([\s\S]*?)\]/m)?.[1] ?? "").replace(/#[^\n]*/g, "").split(/[\s,]+/).filter(Boolean);
const host = JSON.parse(readFileSync(join(measured, "measured.json"), "utf8")).url as string;

writeFileSync(join(dir, "brief.md"), `# A skin after ${new URL(host).hostname}

A Rubric site is drawn by a theme: a palette, a pairing of faces and a scale of sizes, which are already made for this site (\`palette.yaml\`, \`pairing.yaml\`, \`scale.yaml\`, measured from it), and a **skin**: a small CSS layer for what those three cannot say. Write the skin.

## Look first

- \`site-desktop.png\` and \`site-phone.png\`: the top of a post on the site, at 1280 and 390 px wide.
- \`now-desktop.png\` and \`now-phone.png\`: a Rubric page in the measured theme with no skin yet. Its colors, faces and sizes are already the site's.
- \`page.html\`: that page's markup (cut short), with the class names to aim at.
- \`base.css\` and the \`part-*.css\` files: how the page and its frame are drawn before the skin.
- \`example-skin-schematic.css\`: a skin written by hand after another site (makingsoftware.com). Its comments say what each rule is for.

## What the skin does

What makes the site look like itself beyond its colors, faces and sizes: how the site's name and navigation sit in the header, how the title is set, how links are underlined, how a quote, a code block, a callout, a table and a rule look, the space between things, borders, corners, capitals in labels. Look at the two pictures side by side and close the gap.

## Rules

1. Write one file, \`part.css\`: the skin. Plain CSS, with a comment at the top saying in a sentence or two what of the site it draws, and a short comment over each group of rules.
2. Colors, faces, sizes and spacing come only from these custom properties, never literal values: ${slots.map((s) => `\`--${s}\``).join(", ")}. A property the skin sets itself, on the same file, may be read too. Lengths in \`em\`, \`rem\` or \`px\` for small things (a border's width, an offset) are fine.
3. The page keeps its size and place: never change the width or centering of \`main\`, the measure, \`.shell\`, the sidebar or the header's and footer's alignment over the writing. The site may be wider or narrower: the scale already says how wide the writing is.
4. Nothing of the site's own: no \`url()\`, no \`@import\`, no images, no logo, no fonts beyond the pairing's, no copying its CSS. The site's name never appears.
5. Every rule must work on a phone (360 px) and in dark mode, where the same custom properties hold the dark colors.
6. Keep it short: 40 to 150 lines.
`);

// DRY=1: the folder made and left for a look, nothing drafted.
if (process.env.DRY) {
  console.log(dir);
  process.exit(0);
}

const drafter: Drafter = { harness: "claude", model, effort };
const harness = toolHarness(() => drafter, 15 * 60_000);
const started = Date.now();
const log = (line: string) => console.log(`${Math.round((Date.now() - started) / 1000)}s ${line}`);
const run = async (prompt: string) => {
  const r = await harness(dir, prompt, new AbortController().signal, log, drafter, undefined, "tools");
  console.log(`cost $${r.stats?.cost ?? "?"}, ${r.stats?.turns ?? "?"} turns${r.error ? `, error: ${r.error}` : ""}`);
  return r;
};

// Put it in the trial catalog and ask check, as a theme's skin.
const place = () => {
  cpSync(join(dir, "part.css"), join(catalog, "assets/css/skins", `${skin}.css`));
  setSkin(true);
  const check = sh(["bun", "scripts/theme.ts", "check"], { RUBRIC_CATALOG: "../measure/catalog" });
  return check.out.split("\n").filter((l) => l.includes(`skins/${skin}.css`) && l.startsWith("error"));
};

// What look refuses when it draws the theme in a browser: text that can't
// be read against what is really behind it, anything scrolling sideways.
// The same refusal at three widths is one problem.
const looked = () => {
  const out = sh(["bun", "scripts/theme.ts", "look", theme], { RUBRIC_CATALOG: "../measure/catalog" }).out;
  return [...new Set(out.split("\n").filter((l) => l.startsWith("error") && l.includes(theme)).map((l) => l.replace(/ at \d+px/, "")))];
};

try {
  // FIX=1: start from the skin kept last time, and only fix what is refused.
  if (process.env.FIX) cpSync(join(measured, "skin", `${skin}.css`), join(dir, "part.css"));
  else {
    const first = await run("Read brief.md in this folder and do what it asks. Look at every picture it names. Write only part.css, in this folder.");
    if (first.error || !existsSync(join(dir, "part.css"))) throw new Error(first.error ?? "no part.css was written");
  }
  // Up to two rounds: check, then look, each refusal sent back as it is.
  for (let round = 1; round <= 3; round++) {
    let problems = place();
    if (!problems.length) problems = looked();
    if (!problems.length) {
      log(round === 1 ? "check and look pass it" : `check and look pass it after ${round - 1} fix round(s)`);
      break;
    }
    log(`refused:\n${problems.join("\n")}`);
    if (round === 3) break;
    writeFileSync(join(dir, "problems.md"), `The checks refused part.css. Each line says where, what and why; "contrast" is measured in a browser against what is really behind the text, at 360, 768 and 1280 px wide, light and dark:\n\n${problems.map((p) => `- ${p}`).join("\n")}\n\nFix part.css so they pass, changing nothing else.\n`);
    await run("Read problems.md and brief.md in this folder. Fix part.css as problems.md asks, and write only part.css.");
  }
  mkdirSync(join(measured, "skin"), { recursive: true });
  cpSync(join(dir, "part.css"), join(measured, "skin", `${skin}.css`));
  log(`kept in measure/${name}/skin/${skin}.css`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
