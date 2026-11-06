import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogError, formatPlain, loadCatalog, parseCatalog, parsePlain, preprocess, scan } from "../src/core/index.ts";

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
    expect(slice.parts.section!.place).toBe("writing");
  });

  test("a part's place and starter body", () => {
    const c = parseCatalog("name: x\nversion: 1\nparts:\n  header: { description: d, place: site, body: \"- [Posts](/posts/)\\n\" }\n  quote: { description: d }\n");
    expect(c.parts.header).toMatchObject({ place: "site", body: "- [Posts](/posts/)\n" });
    expect(c.parts.quote!.place).toBe("writing");
    expect(c.parts.quote!.body).toBeUndefined();
  });

  test("the universal catalog", async () => {
    const u = await loadCatalog(join(import.meta.dir, "../catalogs/universal/catalog.yaml"));
    const where = Object.values(u.parts).map((p) => p.place);
    expect([where.filter((p) => p === "writing").length, where.filter((p) => p === "site").length]).toEqual([38, 18]);
  });

  test.each([
    ["no parts", "name: x\nversion: 1\nparts: {}\n", "parts must name at least one part"],
    ["bad version", "name: x\nversion: one\nparts: { a: { description: d } }\n", "version"],
    ["bad part name", "name: x\nversion: 1\nparts: { Big: { description: d } }\n", "parts.Big"],
    ["unknown type", "name: x\nversion: 1\nparts: { a: { description: d, settings: { s: { type: color } } } }\n", "parts.a.settings.s.type"],
    ["default not a value", "name: x\nversion: 1\nparts: { a: { description: d, settings: { s: { type: choice, default: c, values: { a: x, b: y } } } } }\n", "parts.a.settings.s.default"],
    ["bad place", "name: x\nversion: 1\nparts: { a: { description: d, place: page } }\n", "parts.a.place must be writing or site"],
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

describe("scan", () => {
  const kind = (line: string) => {
    const [d] = scan(`${line}\n:::\n`, slice).directives;
    return `${d!.kind}${d!.problems.map((p) => ` ${p.code}`).join("")}`;
  };

  test("a plain form being typed is never words, so never sent to Jev", () => {
    expect(kind("::: q")).toBe("plain unfinished-part");
    expect(kind("::: quot")).toBe("plain unfinished-part");
    expect(kind("::: quote size=")).toBe("plain unfinished-setting");
    expect(kind("::: quote size=large ci")).toBe("plain unfinished-setting");
  });

  test("words that start with a part name are still words", () => {
    expect(kind("::: quote from the book")).toBe("words");
    expect(kind("::: a raise")).toBe("words");
    expect(kind("::: callout")).toBe("plain");
  });
});
