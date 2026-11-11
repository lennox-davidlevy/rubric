// Themes, from their pieces in catalogs/<catalog>/themes/.
//
//   bun scripts/theme.ts build              write each piece's CSS
//   bun scripts/theme.ts check              build, then check every piece
//   bun scripts/theme.ts look [theme…]      check, then draw each theme's catalog
//                                           and stress pages in a browser, at
//                                           three widths, and check what is drawn;
//                                           then make their pictures, as previews
//   bun scripts/theme.ts previews [theme…]  the picture of each theme in the
//                                           editor's theme list: previews/<theme>.png
//   bun scripts/theme.ts new palette <name> [--from <name>]
//   bun scripts/theme.ts new pairing <name> [--from <name>]
//   bun scripts/theme.ts new scale <name> [--from <name>]
//   bun scripts/theme.ts new theme <name> <palette> <pairing> <scale>
//
// RUBRIC_CATALOG names the catalog (universal by default).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { check, KINDS, load, outputs, type Kind, type Problem, ThemeError } from "../src/theme.ts";
import { look, previews } from "./look.ts";

const repo = join(import.meta.dir, "..");
const dir = join(repo, "catalogs", process.env.RUBRIC_CATALOG ?? "universal");
const tty = process.stdout.isTTY;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const [red, yellow, green, dim] = [paint(31), paint(33), paint(32), paint(2)];

function build() {
  const files = outputs(load(dir));
  let changed = 0;
  for (const [path, css] of Object.entries(files)) {
    const file = join(dir, path);
    if (existsSync(file) && readFileSync(file, "utf8") === css) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, css);
    console.log(`${dim("wrote")} ${path}`);
    changed++;
  }
  if (!changed) console.log(dim(`${Object.keys(files).length} theme files, all up to date`));
}

function report(problems: Problem[]): boolean {
  for (const p of problems) console.log(`${p.level === "error" ? red("error") : yellow("warn ")} ${p.where}: ${p.message}`);
  const errors = problems.filter((p) => p.level === "error").length;
  const warnings = problems.length - errors;
  console.log(errors ? red(`${errors} error(s), ${warnings} warning(s)`) : green(`fit to ship${warnings ? `, ${warnings} warning(s)` : ""}`));
  return errors === 0;
}

function newPiece(kind: Kind, name: string, from: string) {
  const src = join(dir, "themes", kind, `${from}.yaml`);
  const dst = join(dir, "themes", kind, `${name}.yaml`);
  if (!existsSync(src)) throw new ThemeError(`no ${kind.slice(0, -1)} "${from}" to start from`);
  if (existsSync(dst)) throw new ThemeError(`themes/${kind}/${name}.yaml already exists`);
  copyFileSync(src, dst);
  console.log(`${dim("wrote")} themes/${kind}/${name}.yaml, a copy of ${from}. Change it, then run check.`);
}

function newTheme(name: string, palette: string, pairing: string, scale: string) {
  const cat = load(dir);
  if (cat.themes[name]) throw new ThemeError(`themes.yaml already has "${name}"`);
  for (const [kind, piece] of [["palettes", palette], ["pairings", pairing], ["scales", scale]] as const) {
    if (!cat[kind][piece]) throw new ThemeError(`no ${kind.slice(0, -1)} "${piece}"; make one with: new ${kind.slice(0, -1)} ${piece}`);
  }
  const description = `${cat.palettes[palette]!.description}, set in ${cat.pairings[pairing]!.description.split(",")[0]}`;
  const entry = `\n${name}:\n  description: ${description}\n  palette: ${palette}\n  pairing: ${pairing}\n  scale: ${scale}\n`;
  writeFileSync(join(dir, "themes.yaml"), readFileSync(join(dir, "themes.yaml"), "utf8") + entry);
  console.log(`${dim("added")} ${name} to themes.yaml. Its catalog page is /${name}/ and its stress page /stress/${name}/.`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "build") build();
  else if (command === "check") {
    build();
    process.exit(report(check(load(dir))) ? 0 : 1);
  } else if (command === "look") {
    build();
    const ok = report(check(load(dir)));
    const themes = args.length ? args : Object.keys(load(dir).themes);
    const drawn = await look(dir, themes);
    const fine = report(drawn);
    await previews(dir, themes);
    process.exit(ok && fine ? 0 : 1);
  } else if (command === "previews") {
    build();
    const themes = args.length ? args : Object.keys(load(dir).themes);
    const made = await previews(dir, themes);
    console.log(dim(`${made.length} pictures in ${join(dir, "previews")}`));
  } else if (command === "new") {
    const [what, name, ...rest] = args;
    const from = rest[rest.indexOf("--from") + 1];
    const kind = `${what}s` as Kind;
    if (what === "theme" && name && rest.length === 3) newTheme(name, rest[0]!, rest[1]!, rest[2]!);
    else if (KINDS.includes(kind) && name) {
      const first = { palettes: "paper", pairings: "source-serif", scales: "reading" }[kind];
      newPiece(kind, name, rest.includes("--from") && from ? from : first);
    } else throw new ThemeError("new palette|pairing|scale <name> [--from <name>], or new theme <name> <palette> <pairing> <scale>");
  } else {
    console.log(readFileSync(import.meta.path, "utf8").split("\n\n")[0]!.replace(/^\/\/ ?/gm, ""));
    process.exit(command ? 1 : 0);
  }
} catch (e) {
  if (!(e instanceof ThemeError)) throw e;
  console.log(red(e.message));
  process.exit(1);
}
