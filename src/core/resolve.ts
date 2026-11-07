// Turns Jev's answers for one directive line into an outcome, through the
// truth table in docs/plan.md. Jev makes the judgments; every decision is
// here, in code. Rows for pinned and cached lines live in the preprocessor and
// the cache, and the API-error row in the client.

import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { settingsOf, type Catalog } from "./catalog.ts";
import { formatPlain } from "./plain.ts";
import { BEYOND, fitsId, lookId, lookSaidId, PART, saidId, settingId, THRESHOLDS, toldId } from "./questions.ts";

export type Answer = NoulResponse | ChoiceResponse | ScoreResponse;
export type Answers = Readonly<Record<string, Answer>>;

// A part with the settings its answers give, written as plain form. Settings
// at their default are left out, and so are settings whose answer was not
// settled, which are named so the editor can say so.
export interface Candidate {
  part: string;
  probability: number;
  plain: string;
  unsettled: string[];
}

export type Resolution =
  // The first candidate is placed. A second is offered when it is close.
  | { outcome: "placed"; fits: number; parts: Record<string, number>; candidates: Candidate[] }
  // Something may fit, but not clearly. Nothing is placed; the top two are offered.
  | { outcome: "unsettled"; fits: number; parts: Record<string, number>; candidates: Candidate[] }
  // Nothing in the catalog fits. The line stays plain; the slow path is offered.
  | { outcome: "nothing-fits"; fits: number; parts: Record<string, number>; candidates: [] }
  // The request failed. Never read as "no" or "nothing fits".
  | { outcome: "error"; message: string };

export class AnswerError extends Error {}

export function resolve(answers: Answers, catalog: Catalog): Resolution {
  const parts = { ...choiceAnswer(answers, PART).probabilities } as Record<string, number>;
  const ranked = Object.entries(parts)
    .filter(([name]) => Object.hasOwn(catalog.parts, name))
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) throw new AnswerError("the part answer names no part in the catalog");

  // Whether the picked part fits is its own answer: the Choice always picks.
  // How sure the Choice is counts too: a split Choice is never placed, and a
  // Choice that is all but certain, among many parts, needs only a fair fit.
  // It never overrules a fit below no.
  const [top, runnerUp] = ranked;
  const fits = noul(answers, fitsId(top![0]));
  const sure = top![1] >= THRESHOLDS.sure && Object.keys(catalog.parts).length >= THRESHOLDS.sureFrom;
  if (fits < THRESHOLDS.no) return { outcome: "nothing-fits", fits, parts, candidates: [] };

  const candidates = [candidate(answers, catalog, top![0], top![1])];
  if (runnerUp) candidates.push(candidate(answers, catalog, runnerUp[0], runnerUp[1]));

  const place = (fits > THRESHOLDS.yes && top![1] >= THRESHOLDS.majority) || (sure && fits >= THRESHOLDS.fitsWhenSure);
  if (!place) return { outcome: "unsettled", fits, parts, candidates };

  const close = runnerUp !== undefined && runnerUp[1] >= THRESHOLDS.close;
  return { outcome: "placed", fits, parts, candidates: close ? candidates : candidates.slice(0, 1) };
}

function candidate(answers: Answers, catalog: Catalog, part: string, probability: number): Candidate {
  const settings: { key: string; value: string }[] = [];
  const unsettled: string[] = [];

  for (const [name, def] of Object.entries(catalog.parts[part]!.settings)) {
    // A choice or level the line says nothing about stays at its default,
    // whatever value its own question picked.
    if (def.type === "choice" || def.type === "level") {
      const said = noul(answers, saidId(part, name));
      if (said < THRESHOLDS.no) continue;
      if (said <= THRESHOLDS.yes) {
        unsettled.push(name);
        continue;
      }
    }
    let value: string | undefined;
    switch (def.type) {
      case "choice": {
        const a = choiceAnswer(answers, settingId(part, name));
        const [best, p] = top(a.probabilities as Record<string, number>);
        value = p >= THRESHOLDS.settled && Object.hasOwn(def.values, best) ? best : undefined;
        if (value === undefined) unsettled.push(name);
        else if (value === def.default) value = undefined;
        break;
      }
      case "level": {
        // A Score's position can sit between two levels and hide a split, so
        // the level with the most probability is read, not the position.
        const a = scoreAnswer(answers, settingId(part, name));
        const [best, p] = top(a.probabilities as Record<string, number>);
        const level = Object.keys(def.levels)[Number(best)];
        value = p >= THRESHOLDS.settled ? level : undefined;
        if (value === undefined) unsettled.push(name);
        else if (value === def.default) value = undefined;
        break;
      }
      case "flag": {
        const yes = noul(answers, settingId(part, name));
        const flag = yes > THRESHOLDS.yes ? true : yes < THRESHOLDS.no ? false : undefined;
        if (flag === undefined) unsettled.push(name);
        else if (flag !== (def.default ?? false)) value = String(flag);
        break;
      }
      case "text":
      case "number":
      case "image":
        break;
    }
    if (value !== undefined) settings.push({ key: name, value });
  }

  // The look, asked once for the line, applies to whichever part it is.
  if (catalog.parts[part]!.place === "writing") {
    for (const [name, def] of Object.entries(catalog.look)) {
      if (def.type !== "choice" || !answers[lookId(name)]) continue;
      const said = noul(answers, lookSaidId(name));
      if (said < THRESHOLDS.no) continue;
      const [best, p] = top(choiceAnswer(answers, lookId(name)).probabilities as Record<string, number>);
      // The line's "big" is what picked a part that is already big.
      if (catalog.parts[part]!.already?.[name] === best) continue;
      if (said <= THRESHOLDS.yes) {
        unsettled.push(name);
        continue;
      }
      if (p < THRESHOLDS.settled || !Object.hasOwn(def.values, best)) unsettled.push(name);
      else if (best !== def.default) settings.push({ key: name, value: best });
    }
  }

  return { part, probability, plain: formatPlain({ part, settings }), unsettled };
}

// What the words after a pinned part's ":" ask of it. `settings` holds every
// setting the words speak to, at the value they ask for, a default included;
// the rest are left as the pin has them. `unsettled` are spoken to with no
// clear value; `beyond` is how much the words ask for what no setting does.
export interface Refined {
  settings: Record<string, string>;
  unsettled: string[];
  beyond: number;
}

export function resolveRefine(answers: Answers, catalog: Catalog, part: string): Refined {
  const settings: Record<string, string> = {};
  const unsettled: string[] = [];
  for (const [name, def] of Object.entries(settingsOf(catalog, part))) {
    if (def.type !== "choice" && def.type !== "level" && def.type !== "flag") continue;
    const told = noul(answers, toldId(part, name));
    if (told < THRESHOLDS.no) continue;
    if (told <= THRESHOLDS.yes) {
      unsettled.push(name);
      continue;
    }
    let value: string | undefined;
    if (def.type === "choice") {
      const [best, p] = top(choiceAnswer(answers, settingId(part, name)).probabilities as Record<string, number>);
      value = p >= THRESHOLDS.settled && Object.hasOwn(def.values, best) ? best : undefined;
    } else if (def.type === "level") {
      const [best, p] = top(scoreAnswer(answers, settingId(part, name)).probabilities as Record<string, number>);
      value = p >= THRESHOLDS.settled ? Object.keys(def.levels)[Number(best)] : undefined;
    } else {
      const yes = noul(answers, settingId(part, name));
      value = yes > THRESHOLDS.yes ? "true" : yes < THRESHOLDS.no ? "false" : undefined;
    }
    if (value === undefined) unsettled.push(name);
    else settings[name] = value;
  }
  return { settings, unsettled, beyond: noul(answers, BEYOND) };
}

// The pin after a refinement: each setting the words speak to at its new
// value, dropped when that is the default, and every other setting as it was.
export function applyRefine(
  form: { part: string; settings: readonly { key: string; value: string }[] }, refined: Refined, catalog: Catalog,
): { part: string; settings: { key: string; value: string }[] } {
  const defs = settingsOf(catalog, form.part);
  const isDefault = (key: string, value: string) => {
    const d = defs[key];
    return d !== undefined && "default" in d && d.default !== undefined ? String(d.default) === value : d?.type === "flag" && value === "false";
  };
  const settings = form.settings.filter((s) => !Object.hasOwn(refined.settings, s.key)).map(({ key, value }) => ({ key, value }));
  for (const [key, value] of Object.entries(refined.settings)) {
    if (!isDefault(key, value)) settings.push({ key, value });
  }
  // Settings in the catalog's order, so the same pin always reads the same.
  const order = Object.keys(defs);
  settings.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { part: form.part, settings };
}

function top(probabilities: Record<string, number>): [string, number] {
  const best = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new AnswerError("an answer has no probabilities");
  return best;
}

function noul(answers: Answers, id: string): number {
  const a = answers[id];
  if (a?.type !== "noul") throw new AnswerError(`missing noul answer ${id}`);
  return a.noul;
}

function choiceAnswer(answers: Answers, id: string): ChoiceResponse {
  const a = answers[id];
  if (a?.type !== "choice") throw new AnswerError(`missing choice answer ${id}`);
  return a;
}

function scoreAnswer(answers: Answers, id: string): ScoreResponse {
  const a = answers[id];
  if (a?.type !== "score") throw new AnswerError(`missing score answer ${id}`);
  return a;
}
