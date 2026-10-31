// A stand-in for Jev, for the editor work and the tests: no network, the same
// answer every time. A line naming a part places that part; "slow" waits a
// while first, "offline" fails like a network error, and anything else fits
// nothing.

import type { Catalog, Resolution } from "../core/index.ts";
import type { Resolver } from "./workspace.ts";

export function stubResolver(catalog: Catalog, delayMs = 50): Resolver {
  return async (directive) => {
    const words = directive.toLowerCase().split(/\W+/);
    await new Promise((r) => setTimeout(r, words.includes("slow") ? delayMs * 10 : delayMs));
    if (words.includes("offline")) return { resolution: { outcome: "error", message: "could not reach Jev: offline (stub)" }, model: "stub" };

    const names = Object.keys(catalog.parts);
    const part = names.find((n) => words.includes(n));
    const parts = Object.fromEntries(names.map((n) => [n, n === part ? 0.9 : 0.1 / names.length]));
    const resolution: Resolution = part
      ? { outcome: "placed", fits: 0.9, parts, candidates: [{ part, probability: 0.9, plain: words.includes("big") && part === "quote" ? "quote size=large" : part, unsettled: [] }] }
      : { outcome: "nothing-fits", fits: 0.1, parts, candidates: [] };
    return { resolution, model: "stub" };
  };
}
