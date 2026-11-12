// A site's own parts, from parts/ at the site's root.
//
//   bun scripts/part.ts list <site>            the site's parts, and any that don't parse
//   bun scripts/part.ts global <site> <name>   move one into the site's catalog, for
//                                              every theme and site, with the version
//                                              bumped; the catalog page is built in
//                                              every theme first, and nothing changes
//                                              if Hugo refuses it
//
// Restart the editor's server, or change hugo.toml, to have it read the catalog again.

import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { makeGlobal } from "../src/parts.ts";
import { openSite } from "../src/site.ts";

const [command, siteArg, name] = process.argv.slice(2);
if (!siteArg || (command !== "list" && command !== "global") || (command === "global" && !name)) {
  console.log(readFileSync(import.meta.path, "utf8").split("\n\n")[0]!.replace(/^\/\/ ?/gm, ""));
  process.exit(command ? 1 : 0);
}

const site = await openSite(resolve(siteArg));
const own = Object.entries(site.own).filter(([, o]) => o.part.origin === "site");
if (command === "list") {
  for (const [n, o] of own) console.log(`${n}: ${o.part.description}`);
  for (const p of site.ownProblems) console.log(`left out: ${p}`);
  if (own.length === 0 && site.ownProblems.length === 0) console.log("this site has no parts of its own");
} else {
  const found = own.find(([n]) => n === name);
  if (!found) {
    console.log(`${name} is not one of this site's parts (parts/${name}/)`);
    process.exit(1);
  }
  try {
    const version = await makeGlobal(site.themeDir, found[1].dir, name!);
    await rm(join(site.root, "parts", name!), { recursive: true, force: true });
    console.log(`${name} is in ${site.catalog.name} now, version ${version}, for every theme. parts/${name}/ is gone from the site.`);
  } catch (err) {
    console.log(`not moved: ${(err as Error).message}`);
    process.exit(1);
  }
}
