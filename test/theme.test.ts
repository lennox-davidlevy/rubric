// Themes: the generator's arithmetic, the checks, and the blog catalog's own
// themes, which must be built and fit to ship.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { check, checkPairing, checkPalette, contrast, cssString, fluid, hex, lint, load, parsePairing, parsePalette } from "../src/theme.ts";

const blog = join(import.meta.dir, "../catalogs/blog");

describe("theme arithmetic", () => {
  test("a fluid size matches Utopia's", () => {
    expect(fluid(15, 16, [360, 1240])).toBe("clamp(0.9375rem, 0.912rem + 0.114vw, 1rem)");
    expect(fluid(16, 16, [360, 1240])).toBe("1rem");
  });
  test("contrast runs from 1 to 21", () => {
    expect(contrast(hex("#000000"), hex("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrast(hex("#9a3412"), hex("#9a3412"))).toBe(1);
  });
  test("a CSS string escapes what is outside ASCII, and only spaces when it must", () => {
    expect(cssString("* * *")).toBe(`"*\\2002*\\2002*"`);
    expect(cssString(" a")).toBe(`"\\2002 a"`);
    expect(cssString(`say "hi"`)).toBe(`"say \\"hi\\""`);
  });
});

describe("the blog catalog's themes", () => {
  test("are built and fit to ship", () => {
    expect(check(load(blog)).filter((p) => p.level === "error")).toEqual([]);
  });
});

describe("checks", () => {
  const paper = { description: "d", scheme: "light", paper: "#f9f6ef", ink: "#221e19", accent: "#9a3412", muted: "#6b6357", rule: "#e2dacb", tint: "#f1e9d9" };

  test("an accent too dark for the dark band is refused, naming where it shows", () => {
    const p = parsePalette("p", { ...paper, dark: { paper: "#2a2520", ink: "#f3ede2", accent: "#9a3412" } });
    const errors = checkPalette(p).filter((x) => x.level === "error").map((x) => x.message);
    expect(errors[0]).toContain("dark-accent on dark-paper (quote marks, ornaments and links in a dark band) has contrast 2.08");
  });

  test("derived colors can be set by hand", () => {
    const p = parsePalette("p", { ...paper, raised: "#ffffff", dark: { paper: "#2a2520", ink: "#f3ede2", accent: "#e5936a", tint: "#333333" } });
    expect(p.colors.raised).toBe("#ffffff");
    expect(p.colors["dark-tint"]).toBe("#333333");
    // What Chrome draws for color-mix(in srgb, accent 8%, paper): rgb(241, 230, 221).
    expect(p.colors["accent-tint"]).toBe("#f1e6dd");
  });

  test("a weight no face can draw is refused", () => {
    const p = parsePairing("x", {
      description: "d", faces: [{ family: "A", file: "a.woff2", style: "normal", weight: 400 }], preload: ["a.woff2"],
      body: ["A", "serif"], display: "body", mono: ["monospace"],
      weight: { body: 400, strong: 700, heading: 700, display: 400 }, leading: { body: 1.5, heading: 1.2, display: 1.1 },
      tracking: { display: "0", label: "0" }, labels: "none", numerals: "lining", quote: "normal", ornament: "*", code: "0.9em",
    });
    const messages = checkPairing(p, "/nowhere").map((x) => `${x.level} ${x.message}`);
    expect(messages).toContain("error no font file a.woff2 in static/fonts/");
    expect(messages).toContain("error A has no normal face at weight 700; the browser would fake it");
    expect(messages).toContain("warning A has no italic face at weight 400; the browser would fake it");
  });

  test("shared CSS may read slots only, never a literal color, font or weight", () => {
    const cat = { ...load(blog) };
    const problems = lint(cat, { "x.css": ".a { color: #fff; font-weight: 700; font-family: Georgia; margin: var(--nope); --pad: 1rem; padding: var(--pad) var(--space-2); }" });
    expect(problems.map((p) => p.message)).toEqual([
      "--nope is not a slot in catalog.yaml",
      "a literal color; use a slot",
      "a literal font weight; use a weight slot",
      "a literal font; use a font slot",
    ]);
  });
});
