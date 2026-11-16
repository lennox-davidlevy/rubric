import { expect, test } from "bun:test";
import { header, rows, type Call } from "../src/watch.ts";

const line: Call = {
  t: 0,
  ms: 412,
  model: "m",
  request: { model: "m", state: { directive: "the three things I learned, in order, with a picture of each one and a long tail", page: "post" }, questions: {} },
  resolution: { outcome: "unsettled", fits: 0.64, parts: { steps: 0.55, timeline: 0.3 }, candidates: [{ part: "steps", probability: 0.55, plain: "steps", unsettled: ["numbers"] }] },
};
const theme = { t: 0, ms: 380, pass: "theme", request: { state: { directive: "calm and bookish" } }, order: { terminal: 0.1, paper: 0.6 } } as Call;
const traits = { t: 0, ms: 250, pass: "traits", request: { state: { request: "a strip of tide times" } }, traits: { data: 0.9, motion: 0.1 } } as Call;
const second = { t: 0, ms: 300, pass: "second", part: "quote", request: { model: "m", state: { directive: "larger" } }, refined: { settings: { size: "large" }, unsettled: [], beyond: 0 } } as Call;

test.each([60, 80, 140])("every row fits a terminal %p columns wide", (columns) => {
  for (const l of [...header(columns), ...[line, theme, second, traits].flatMap((c, i) => rows(c, i + 1, columns))]) {
    expect(l.length).toBeLessThanOrEqual(columns);
  }
});

test("each kind of call gets a row with what it became", () => {
  const [placedRow, weighed] = rows(line, 1, 140);
  expect(placedRow).toContain("unsettled");
  expect(weighed).toContain("timeline");
  // The theme line's order, surest first.
  expect(rows(theme, 2, 140)[0]).toMatch(/paper.*terminal/);
  expect(rows(second, 3, 140)[0]).toContain("size=large");
  // A new part's traits: the ones Jev was sure of.
  expect(rows(traits, 4, 140)[0]).toMatch(/data/);
  expect(rows(traits, 4, 140)[0]).not.toMatch(/motion/);
});
