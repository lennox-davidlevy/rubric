// The question generator, the truth table and the cache, with hand-written
// answers. Tests assert outcomes, never exact probabilities.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnswerError, buildQuestions, Cache, CatalogError, fitsId, loadCatalog, PART, parseCatalog, resolve, saidId, settingId, THRESHOLDS,
  type Answer, type Answers,
} from "../src/core/index.ts";

const sliceYaml = await Bun.file(join(import.meta.dir, "../catalogs/slice/catalog.yaml")).text();
const catalog = parseCatalog(sliceYaml);

describe("buildQuestions", () => {
  const q = buildQuestions(catalog);

  test("one part choice, a fits per part, and a value and a said per asked setting", () => {
    expect(Object.keys(q).sort()).toEqual([
      PART,
      fitsId("callout"), fitsId("quote"), fitsId("section"),
      settingId("callout", "kind"), saidId("callout", "kind"),
      settingId("quote", "align"), saidId("quote", "align"), settingId("quote", "size"), saidId("quote", "size"),
      settingId("section", "shadow"), saidId("section", "shadow"),
      settingId("section", "surface"), saidId("section", "surface"),
      settingId("section", "tone"), saidId("section", "tone"),
    ].sort());
  });

  test("the part choice uses the part descriptions as its criteria", () => {
    expect(q[PART]).toMatchObject({ type: "choice", criteria: { quote: catalog.parts.quote!.description } });
  });

  test("a part's fits noul carries its description, since it cannot see the part choice", () => {
    expect(q[fitsId("callout")]).toMatchObject({ type: "noul", instructions: { part: catalog.parts.callout!.description } });
  });

  test("a said noul lists only the values other than the default", () => {
    expect(q[saidId("section", "tone")]).toMatchObject({ type: "noul" });
    expect(Object.keys((q[saidId("section", "tone")]!.instructions as { values: object }).values)).toEqual(["tint", "dark"]);
  });

  test("a level becomes a score with its levels in order", () => {
    expect(q[settingId("section", "shadow")]).toEqual({
      type: "score",
      instructions: "How much shadow does `directive` ask the section to have?",
      criteria: ["no shadow at all", "a faint shadow, barely there", "a strong shadow, clearly floating"],
    });
  });

  test("text settings are never asked", () => {
    expect(q[settingId("quote", "cite")]).toBeUndefined();
  });

  test("a catalog can override a setting's question", () => {
    const c = parseCatalog(`
name: x
version: 1
parts:
  a:
    description: d
    settings:
      s: { type: choice, default: one, question: "Is it one or two?", values: { one: first, two: second } }
`);
    expect(buildQuestions(c)[settingId("a", "s")]).toMatchObject({ instructions: "Is it one or two?" });
  });

  test("choice and level settings must have a default", () => {
    expect(() => parseCatalog("name: x\nversion: 1\nparts: { a: { description: d, settings: { s: { type: choice, values: { a: x, b: y } } } } }\n")).toThrow(CatalogError);
  });
});

// Answers where everything is clear and at its default, with overrides. A
// setting given in `settings` counts as asked for (said yes) unless `said`
// says otherwise; every other setting counts as not mentioned.
function answers(over: {
  fits?: number;
  parts?: Record<string, number>;
  settings?: Record<string, Answer>;
  said?: Record<string, number>;
} = {}): Answers {
  const base: Record<string, Answer> = {
    [PART]: choice(over.parts ?? { quote: 0.9, callout: 0.06, section: 0.04 }),
    [settingId("quote", "size")]: choice({ normal: 0.9, large: 0.1 }),
    [settingId("quote", "align")]: choice({ left: 0.9, center: 0.1 }),
    [settingId("callout", "kind")]: choice({ note: 0.9, aside: 0.05, warning: 0.05 }),
    [settingId("section", "tone")]: choice({ theme: 0.9, tint: 0.05, dark: 0.05 }),
    [settingId("section", "surface")]: choice({ flat: 0.9, raised: 0.1 }),
    [settingId("section", "shadow")]: score({ 0: 0.9, 1: 0.05, 2: 0.05 }),
    ...over.settings,
  };
  for (const part of Object.keys(catalog.parts)) base[fitsId(part)] = { type: "noul", noul: over.fits ?? 0.95 };
  for (const id of Object.keys(base).filter((k) => k.startsWith("setting:"))) {
    const said = id.replace(/^setting:/, "said:");
    base[said] = { type: "noul", noul: over.said?.[said] ?? (over.settings && id in over.settings ? 0.95 : 0.05) };
  }
  return base;
}

function choice(probabilities: Record<string, number>): Answer {
  const [best] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!;
  return { type: "choice", choice: best, confidence: 0.9, probabilities } as unknown as Answer;
}

function score(probabilities: Record<number, number>): Answer {
  const position = Object.entries(probabilities).reduce((sum, [level, p]) => sum + Number(level) * p, 0);
  // The SDK's score types are generic over the levels; a test answer has none.
  return { type: "score", score: position, confidence: 0.5, legend: {}, probabilities } as unknown as Answer;
}

describe("the truth table", () => {
  // A Choice that is not all but certain, so only the fits answer decides.
  const unsure = { quote: 0.6, callout: 0.25, section: 0.15 };

  test("nothing fits: the line stays plain", () => {
    const r = resolve(answers({ fits: 0.1, parts: unsure }), catalog);
    expect(r.outcome).toBe("nothing-fits");
  });

  test("fits is unsettled: nothing is placed and the top two parts are offered", () => {
    const r = resolve(answers({ fits: 0.5, parts: { quote: 0.5, callout: 0.4, section: 0.1 } }), catalog);
    expect(r.outcome).toBe("unsettled");
    if (r.outcome !== "unsettled") return;
    expect(r.candidates.map((c) => c.part)).toEqual(["quote", "callout"]);
  });

  test("the thresholds themselves are unsettled", () => {
    expect(resolve(answers({ fits: 0.3, parts: unsure }), catalog).outcome).toBe("unsettled");
    expect(resolve(answers({ fits: 0.7, parts: unsure }), catalog).outcome).toBe("unsettled");
  });

  // A catalog large enough for the Choice's confidence to count: the slice's
  // three parts plus filler.
  const large = parseCatalog(sliceYaml.replace(/^parts:\n/m, `parts:\n${Array.from({ length: THRESHOLDS.sureFrom }, (_, i) => `  filler-${i}:\n    description: filler ${i}\n`).join("")}`));
  const withFiller = (a: Answers) => ({ ...a, ...Object.fromEntries(Object.keys(large.parts).filter((p) => p.startsWith("filler")).map((p) => [fitsId(p), { type: "noul", noul: 0.1 } as Answer])) });

  test("among many parts, a Choice all but certain needs only a fair fit to be placed", () => {
    expect(resolve(withFiller(answers({ fits: 0.5 })), large).outcome).toBe("placed");
    expect(resolve(withFiller(answers({ fits: 0.39 })), large).outcome).toBe("unsettled");
  });

  test("among few parts, a sure Choice counts for nothing: it is sure of the closest part to anything", () => {
    expect(resolve(answers({ fits: 0.5 }), catalog).outcome).toBe("unsettled");
  });

  test("a Choice all but certain never overrules a fit below no", () => {
    expect(resolve(withFiller(answers({ fits: 0.1 })), large).outcome).toBe("nothing-fits");
  });

  test("a split Choice is never placed, however clear the fit: both are offered", () => {
    const r = resolve(answers({ fits: 0.95, parts: { quote: 0.45, callout: 0.4, section: 0.15 } }), catalog);
    expect(r.outcome).toBe("unsettled");
    expect(r.outcome === "unsettled" && r.candidates.map((c) => c.part)).toEqual(["quote", "callout"]);
  });

  test("fits, top two parts close: the top part is placed and the runner-up offered", () => {
    const r = resolve(answers({ parts: { quote: 0.55, callout: 0.4, section: 0.05 } }), catalog);
    expect(r.outcome).toBe("placed");
    if (r.outcome !== "placed") return;
    expect(r.candidates.map((c) => c.plain)).toEqual(["quote", "callout"]);
  });

  test("fits, clear part, one setting unsettled: placed with that setting at its default, and named", () => {
    const r = resolve(answers({ settings: {
      [settingId("quote", "size")]: choice({ normal: 0.5, large: 0.5 }),
      [settingId("quote", "align")]: choice({ left: 0.1, center: 0.9 }),
    } }), catalog);
    expect(r.outcome).toBe("placed");
    if (r.outcome !== "placed") return;
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ plain: "quote align=center", unsettled: ["size"] });
  });

  test("fits, everything clear: placed with the settings the answers give", () => {
    const r = resolve(answers({ settings: {
      [settingId("quote", "size")]: choice({ normal: 0.1, large: 0.9 }),
      [settingId("quote", "align")]: choice({ left: 0.1, center: 0.9 }),
    } }), catalog);
    expect(r.outcome === "placed" && r.candidates[0]).toMatchObject({ plain: "quote size=large align=center", unsettled: [] });
  });

  test("settings at their default are left out of the plain form", () => {
    const r = resolve(answers(), catalog);
    expect(r.outcome === "placed" && r.candidates[0]!.plain).toBe("quote");
  });

  test("a level is read from its probabilities, not its position", () => {
    const section = { parts: { section: 0.9, quote: 0.05, callout: 0.05 } };
    const deep = resolve(answers({ ...section, settings: { [settingId("section", "shadow")]: score({ 0: 0.05, 1: 0.15, 2: 0.8 }) } }), catalog);
    expect(deep.outcome === "placed" && deep.candidates[0]!.plain).toBe("section shadow=deep");

    // Split between none and deep: the position says "soft", which nobody asked for.
    const split = resolve(answers({ ...section, settings: { [settingId("section", "shadow")]: score({ 0: 0.5, 1: 0, 2: 0.5 }) } }), catalog);
    expect(split.outcome === "placed" && split.candidates[0]).toMatchObject({ plain: "section", unsettled: ["shadow"] });
  });

  test("fits is read from the picked part, not from any part", () => {
    const a = { ...answers({ parts: unsure }), [fitsId("quote")]: { type: "noul", noul: 0.1 } as Answer };
    expect(resolve(a, catalog).outcome).toBe("nothing-fits");
  });

  test("a setting the line does not mention stays at its default, whatever value its question picked", () => {
    const r = resolve(answers({
      settings: { [settingId("quote", "align")]: choice({ left: 0.05, center: 0.95 }) },
      said: { [saidId("quote", "align")]: 0.1 },
    }), catalog);
    expect(r.outcome === "placed" && r.candidates[0]).toMatchObject({ plain: "quote", unsettled: [] });
  });

  test("a setting the line may or may not mention stays at its default, and is named", () => {
    const r = resolve(answers({
      settings: { [settingId("quote", "align")]: choice({ left: 0.05, center: 0.95 }) },
      said: { [saidId("quote", "align")]: 0.5 },
    }), catalog);
    expect(r.outcome === "placed" && r.candidates[0]).toMatchObject({ plain: "quote", unsettled: ["align"] });
  });

  test("a missing answer is an error, never a guess", () => {
    const { [saidId("quote", "size")]: _, ...rest } = answers();
    expect(() => resolve(rest, catalog)).toThrow(AnswerError);
  });
});

describe("Cache", () => {
  const placed = resolve(answers({ settings: { [settingId("quote", "size")]: choice({ normal: 0.1, large: 0.9 }) } }), catalog);

  test("a placed line resolves to its plain form; other outcomes resolve to nothing", () => {
    const cache = new Cache();
    cache.set(catalog, "post", "a big quote", placed, "jev-1.14.0");
    cache.set(catalog, "post", "my taxes", resolve(answers({ fits: 0.1, parts: { quote: 0.5, callout: 0.3, section: 0.2 } }), catalog), "jev-1.14.0");
    const lookup = cache.resolver(catalog, "post");
    expect(lookup("a big quote")?.settings.map((s) => [s.key, s.value])).toEqual([["size", "large"]]);
    expect(lookup("my taxes")).toBeUndefined();
    expect(cache.get(catalog, "post", "my taxes")?.outcome).toBe("nothing-fits");
  });

  test("errors are never cached", () => {
    const cache = new Cache();
    cache.set(catalog, "post", "x", { outcome: "error", message: "offline" }, "jev-1.14.0");
    expect(cache.get(catalog, "post", "x")).toBeUndefined();
  });

  test("the key includes the catalog version and the page kind", () => {
    const cache = new Cache();
    cache.set(catalog, "post", "a big quote", placed, "jev-1.14.0");
    expect(cache.get({ ...catalog, version: catalog.version + 1 }, "post", "a big quote")).toBeUndefined();
    expect(cache.get(catalog, "home", "a big quote")).toBeUndefined();
  });

  test("it survives a save and a load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rubric-cache-"));
    try {
      const path = join(dir, ".rubric/cache.json");
      expect((await Cache.load(path)).get(catalog, "post", "a big quote")).toBeUndefined();
      const cache = new Cache();
      cache.set(catalog, "post", "a big quote", placed, "jev-1.14.0");
      await cache.save(path);
      expect((await Cache.load(path)).get(catalog, "post", "a big quote")?.model).toBe("jev-1.14.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("asking in two steps", () => {
  // A stand-in for Jev that answers every question it is sent, and keeps
  // the questions so the test can see what each step asked.
  const answer = (id: string): Answer =>
    id === PART ? { type: "choice", probabilities: { quote: 0.8, callout: 0.15, section: 0.05 } } as unknown as unknown as Answer
    : id.startsWith("fits:") || id.startsWith("said:") ? { type: "noul", noul: id === saidId("quote", "size") ? 0.9 : id.startsWith("fits:") ? 0.9 : 0.1 } as unknown as unknown as Answer
    : id === settingId("quote", "size") ? { type: "choice", probabilities: { normal: 0.1, large: 0.9 } } as unknown as unknown as Answer
    : id.startsWith("setting:") && id.includes(":level") ? { type: "score", score: 0, probabilities: { "0": 1 } } as unknown as unknown as Answer
    : { type: "choice", probabilities: { a: 1 } } as unknown as Answer;

  test("asks which part, then the details of the top two only, and resolves the same way", async () => {
    const sent: string[][] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const ids = Object.keys(JSON.parse(init.body).questions);
      sent.push(ids);
      return new Response(JSON.stringify({ model: "jev-1.14.0", answers: Object.fromEntries(ids.map((id) => [id, answer(id)])) }));
    }) as unknown as typeof fetch;
    try {
      const { ask } = await import("../src/jev.ts");
      const asked = await ask(catalog, "a pull quote", "post", "test-key", 2);
      expect(sent[0]).toEqual([PART]);
      expect(sent[1]!.filter((id) => id.startsWith("fits:")).sort()).toEqual([fitsId("callout"), fitsId("quote")]);
      expect(sent[1]!.some((id) => id.includes(":section"))).toBe(false);
      expect(asked.resolution.outcome).toBe("placed");
      expect(asked.resolution.outcome === "placed" && asked.resolution.candidates[0]!.plain).toBe("quote size=large");
      expect(asked.then?.request.questions).toBeDefined();
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("atPlace", () => {
  test("keeps only the parts chosen in that place", async () => {
    const { atPlace } = await import("../src/core/index.ts");
    const u = await loadCatalog(join(import.meta.dir, "../catalogs/universal/catalog.yaml"));
    expect(Object.keys(atPlace(u, "site").parts)).toContain("header");
    expect(Object.keys(atPlace(u, "site").parts)).not.toContain("quote");
    expect(Object.keys(atPlace(u, "writing").parts)).not.toContain("header");
  });
});
