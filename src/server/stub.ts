// A stand-in for Jev, for the editor work and the tests: no network, the same
// answer every time. A line naming a part places that part; "slow" waits a
// while first, "offline" fails like a network error, a line naming two parts
// is unsure between them, and anything else fits nothing. For the second pass, words naming one of the part's values set
// that setting, and "sparkles" asks for more than any setting does.

import { settingsOf, type Catalog, type Resolution } from "../core/index.ts";
import type { Refiner, Resolver } from "./workspace.ts";

export function stubResolver(catalog: Catalog, delayMs = 50): Resolver {
  return async (directive) => {
    const words = directive.toLowerCase().split(/\W+/);
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
    const resolution: Resolution = part
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
