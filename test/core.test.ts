import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogError, formatPlain, parseCatalog, parsePlain, preprocess } from "../src/core/index.ts";

const sliceYaml = readFileSync(join(import.meta.dir, "../catalogs/slice/catalog.yaml"), "utf8");
const slice = parseCatalog(sliceYaml);

describe("parsePlain", () => {
  test("a part with settings, bare and quoted", () => {
    const form = parsePlain(`quote size=large cite="J. R. R. Tolkien"`, 4)!;
    expect(form.part).toBe("quote");
    expect(form.partSpan).toEqual({ start: 4, end: 9 });
    expect(form.settings.map((s) => [s.key, s.value])).toEqual([["size", "large"], ["cite", "J. R. R. Tolkien"]]);
    expect(form.settings[1]!.valueSpan).toEqual({ start: 26, end: 44 });
  });

  test("an empty quoted value is a value", () => {
    expect(parsePlain(`quote cite=""`)!.settings[0]!.value).toBe("");
  });

  test.each([
    ["callout warning"],
    ["a quote from the book"],
    [`quote cite="never closed`],
    ["quote size="],
    ["quote =large"],
    ["Quote size=large"],
    ["quote Size=large"],
    [""],
  ])("%p is not plain form", (text) => {
    expect(parsePlain(text)).toBeUndefined();
  });

  test("formatPlain quotes only what needs it", () => {
    expect(formatPlain(parsePlain(`quote cite="Tolkien" size=large note="two words"`)!)).toBe(`quote cite=Tolkien size=large note="two words"`);
  });
});

describe("parseCatalog", () => {
  test("the slice catalog", () => {
    expect(slice.name).toBe("slice");
    expect(Object.keys(slice.parts)).toEqual(["section", "quote", "callout"]);
    expect(slice.parts.section!.settings.shadow).toMatchObject({ type: "level", default: "none" });
  });

  test.each([
    ["no parts", "name: x\nversion: 1\nparts: {}\n", "parts must name at least one part"],
    ["bad version", "name: x\nversion: one\nparts: { a: { description: d } }\n", "version"],
    ["bad part name", "name: x\nversion: 1\nparts: { Big: { description: d } }\n", "parts.Big"],
    ["unknown type", "name: x\nversion: 1\nparts: { a: { description: d, settings: { s: { type: colour } } } }\n", "parts.a.settings.s.type"],
    ["default not a value", "name: x\nversion: 1\nparts: { a: { description: d, settings: { s: { type: choice, default: c, values: { a: x, b: y } } } } }\n", "parts.a.settings.s.default"],
    ["one value", "name: x\nversion: 1\nparts: { a: { description: d, settings: { s: { type: choice, values: { a: x } } } } }\n", "at least two"],
  ])("%s", (_, yaml, message) => {
    expect(() => parseCatalog(yaml)).toThrow(CatalogError);
    expect(() => parseCatalog(yaml)).toThrow(message);
  });
});

describe("preprocess", () => {
  const withDivider = parseCatalog(
    sliceYaml + "  divider:\n    description: A line across the page between two runs of prose.\n    children: false\n",
  );

  test("a directive inside a part that takes no children is left as text", () => {
    const src = "::: divider\n::: callout\ninside\n:::\n:::\n";
    const out = preprocess(src, withDivider);
    expect(out.entries.map((e) => [e.plain, e.placed, e.reason])).toEqual([
      ["divider", true, undefined],
      ["callout", false, "no-children"],
    ]);
    expect(out.diagnostics.map((d) => [d.line, d.code])).toEqual([[1, "no-children"]]);
    expect(out.content).toBe("{{< divider >}}\n::: callout\ninside\n:::\n{{< /divider >}}\n");
  });

  test("CRLF line endings are kept", () => {
    const out = preprocess("intro\r\n::: callout\r\nbody\r\n:::\r\n", slice);
    expect(out.content).toBe("intro\r\n{{< callout >}}\r\nbody\r\n{{< /callout >}}\r\n");
  });

  test("a page with no trailing newline keeps none", () => {
    expect(preprocess("::: callout\nbody\n:::", slice).content).toBe("{{< callout >}}\nbody\n{{< /callout >}}");
  });

  test("an unclosed front matter is not front matter", () => {
    const out = preprocess("---\n::: callout\nbody\n:::\n", slice);
    expect(out.entries[0]!.placed).toBe(true);
  });
});
