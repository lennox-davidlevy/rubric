// A stand-in for Jev, for the editor work and the tests: no network, the same
// answer every time. A line naming a part places that part; "slow" waits a
// while first, "offline" fails like a network error, a line naming two parts
// is unsure between them, "nearly" beside a part's name fits nothing though
// that part is the closest, and anything else fits nothing. For the second pass, words naming one of the part's values set
// that setting, and "sparkles" asks for more than any setting does.

import { settingsOf, type Catalog, type Resolution } from "../core/index.ts";
import { join } from "node:path";
import type { Harness } from "./draft.ts";
import type { Refiner, Resolver } from "./workspace.ts";

export function stubResolver(catalog: Catalog, delayMs = 50): Resolver {
  return async (directive) => {
    // A hyphen stays in a word, so a line can name a part such as tide-clock.
    const words = directive.toLowerCase().split(/[^a-z0-9-]+/);
    await new Promise((r) => setTimeout(r, words.includes("slow") ? delayMs * 10 : delayMs));
    if (words.includes("offline")) return { resolution: { outcome: "error", message: "could not reach Jev: offline (stub)" }, model: "stub" };

    const names = Object.keys(catalog.parts);
    // In the order the line names them.
    const named = [...new Set(words.filter((w) => names.includes(w)))];
    const part = named[0];
    // Two parts named, as in "a quote or a callout": unsure between them.
    if (named.length > 1) {
      const [a, b] = [named[0]!, named[1]!];
      const parts = Object.fromEntries(names.map((n) => [n, n === a ? 0.55 : n === b ? 0.4 : 0.05 / names.length]));
      return {
        resolution: {
          outcome: "unsettled", fits: 0.6, parts,
          candidates: [{ part: a, probability: 0.55, plain: a, unsettled: [] }, { part: b, probability: 0.4, plain: b, unsettled: [] }],
        },
        model: "stub",
      };
    }
    const parts = Object.fromEntries(names.map((n) => [n, n === part ? 0.9 : 0.1 / names.length]));
    const resolution: Resolution = part && words.includes("nearly")
      ? { outcome: "nothing-fits", fits: 0.2, parts, candidates: [] }
      : part
      ? { outcome: "placed", fits: 0.9, parts, candidates: [{ part, probability: 0.9, plain: words.includes("big") && part === "quote" ? "quote size=large" : part, unsettled: [] }] }
      : { outcome: "nothing-fits", fits: 0.1, parts, candidates: [] };
    return { resolution, model: "stub" };
  };
}

export function stubRefiner(catalog: Catalog, delayMs = 50): Refiner {
  return async (words, part) => {
    const said = words.toLowerCase().split(/[^a-z0-9-]+/);
    await new Promise((r) => setTimeout(r, said.includes("slow") ? delayMs * 10 : delayMs));
    if (said.includes("offline")) return { error: "could not reach Jev: offline (stub)", model: "stub" };
    const settings: Record<string, string> = {};
    for (const [name, def] of Object.entries(settingsOf(catalog, part))) {
      const values = def.type === "choice" ? Object.keys(def.values) : def.type === "level" ? Object.keys(def.levels) : [];
      const v = values.find((x) => said.includes(x));
      if (v) settings[name] = v;
    }
    return { refined: { settings, unsettled: [], beyond: said.includes("sparkles") ? 0.9 : 0.1 }, model: "stub" };
  };
}

// The theme list's order, without Jev: a theme scores by how many of the
// line's words its name and description share.
export async function stubThemeRanker(words: string, themes: { name: string; description: string }[]): Promise<Record<string, number>> {
  const said = new Set(words.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const scores = themes.map((t) => [t.name, `${t.name} ${t.description}`.toLowerCase().split(/\W+/).filter((w) => said.has(w)).length] as const);
  const total = scores.reduce((n, [, s]) => n + s, 0) || 1;
  return Object.fromEntries(scores.map(([n, s]) => [n, s / total]));
}

// The harness, without Claude Code: writes a small part named for the words
// at once. A line naming a catalog part gets that part back as one that
// already exists; "broken" writes a literal color the first time, which the
// checks refuse, and fixes it when told; "failing" fails like a harness that
// could not run; "slow" takes a while first. Another take of the site's own
// part keeps its name. A fast draft's files go in the reply, not the folder,
// and it is never asked whether the catalog has the part.
export function stubHarness(catalog: Catalog, delayMs = 50): Harness {
  return async (dir, prompt, signal, log = () => {}, _use, _resume, mode) => {
    const fast = mode === "fast";
    const files: Record<string, string> = {};
    const write = async (name: string, text: string) => {
      if (fast) files[name] = text;
      else await Bun.write(join(dir, name), text);
    };
    const done = () => (fast ? { reply: Object.entries(files).map(([f, text]) => `=== ${f}\n${text}`).join("") } : {});
    log("read brief.md");
    const brief = await Bun.file(join(dir, "brief.md")).text();
    const words = (/^> (.*)$/m.exec(brief)?.[1] ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    await new Promise((r) => setTimeout(r, words.includes("slow") ? delayMs * 20 : delayMs));
    if (signal.aborted) return { error: "stopped" };
    if (words.includes("failing")) return { error: "the harness could not run (stub)" };
    const of = /(?:The writer has a part of their own,|this site's own version of the catalog's part) \*\*([a-z0-9-]+)\*\*/.exec(brief)?.[1];
    const named = words.filter((w) => w.length > 2 && !["the", "and", "with", "for", "that", "slow", "broken"].includes(w)).slice(0, 2).join("-") || "made";
    // A reroll with words says them in the part, so a test can see it changed.
    const change = /asked for this change: "([^"]*)"/.exec(brief)?.[1];
    // "name it x" in a change names the take x, so takes can differ in name.
    const renamed = change && /name it ([a-z][a-z0-9-]*)/.exec(change)?.[1];
    const name = renamed || of || named;
    const fixing = /checks refused/i.test(prompt);
    const color = words.includes("broken") && !fixing ? "#ff0000" : "var(--accent)";
    // "no settings" in a change drops the part's setting, as a real reroll may.
    const settings = change?.includes("no settings") ? "" : "settings:\n  pace:\n    type: choice\n    default: slow\n    values:\n      slow: it moves slowly\n      fast: it moves quickly\n";
    // Another take of a part keeps its entry, settings and all, as a real
    // one is asked to, unless the change says otherwise.
    const previous = /^part\.yaml:\n```yaml\n([\s\S]*?)\n```/m.exec(brief)?.[1];
    const keeps = of && previous && !renamed && !change?.includes("no settings");
    await write("part.yaml", keeps ? `${previous}\n` : `name: ${name}\ndescription: A part made for "${words.join(" ")}" by the stub harness.\nchildren: true\n${settings}body: |\n  Something to put in it.\n`);
    // Another take with no change is drawn differently, as a real one would be.
    const another = /wants a different one/.test(brief) ? ` data-take="${Math.random().toString(36).slice(2, 8)}"` : "";
    await write("part.html", `<div class="part part-${name} pace-{{ .s.pace }}"${change ? ` data-change="${change.replace(/"/g, "")}"` : ""}${another}>\n{{ .inner }}\n</div>\n`);
    await write("part.css", `.part-${name} { border-left: 3px solid ${color}; padding-left: var(--space-3); }\n`);
    log("write part.yaml\nwrite part.html\nwrite part.css");
    return done();
  };
}
