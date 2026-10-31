// Everything Rubric says to Jev, and the thresholds it reads the answers by.
// The questions are generated from the catalog file; this module holds the
// only wording that lives outside it, so this is where tuning happens.

import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "@typesafe-ai/sdk";
import type { Catalog, Setting } from "./catalog.ts";

// Pinned to a versioned id, never an alias: an alias can move and change
// answers with no change here, which would break the cache and the promise
// that the same words give the same page.
export const MODEL = "jev-1.14.0";

export const THRESHOLDS = {
  // `fits` above yes reads as yes, below no as no; between is unsettled.
  yes: 0.7,
  no: 0.3,
  // A Choice or a Score is settled when its top option has at least this.
  settled: 0.6,
  // The runner-up part is offered beside the pick when it has at least this.
  close: 0.3,
};

export type PageKind = "home" | "post" | "page";

// A type, not an interface, so it matches the SDK's JSON object type.
export type State = {
  directive: string;
  page: PageKind;
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export const PART = "part";
export const fitsId = (part: string) => `fits:${part}`;
export const saidId = (part: string, setting: string) => `said:${part}:${setting}`;
export const settingId = (part: string, setting: string) => `setting:${part}:${setting}`;

export function buildState(directive: string, page: PageKind): State {
  return { directive, page };
}

// One request per directive line, every question speculative: which part,
// whether each part fits, and for every asked setting of every part, whether
// the line says anything about it and what. Code reads only what belongs to
// the part it picks.
export function buildQuestions(catalog: Catalog): Record<string, Question> {
  const parts = Object.fromEntries(Object.entries(catalog.parts).map(([name, p]) => [name, p.description]));
  const questions: Record<string, Question> = {
    [PART]: {
      type: "choice",
      instructions: "Which part of a web page does `directive` ask for?",
      criteria: parts,
    },
  };
  for (const [partName, part] of Object.entries(catalog.parts)) {
    // A Choice always picks something, so whether the pick fits at all is
    // its own question, one per part.
    questions[fitsId(partName)] = {
      type: "noul",
      instructions: { question: "Does `directive` ask for this part of a web page?", part: part.description },
    };
    for (const [name, setting] of Object.entries(part.settings)) {
      const q = settingQuestion(partName, name, setting);
      if (!q) continue;
      questions[settingId(partName, name)] = q;
      // The same for a setting: a Choice or Score picks a value even when the
      // line never mentions it. So: does the line ask for anything other than
      // the default, with those values described? A line that says nothing,
      // or asks for the default, leaves the setting at its default either way.
      // A flag's own Noul already answers no.
      if (setting.type === "choice" || setting.type === "level") {
        const values = setting.type === "choice" ? setting.values : setting.levels;
        questions[saidId(partName, name)] = {
          type: "noul",
          instructions: {
            question: `Does \`directive\` ask for the ${partName} to have one of these ${name} values?`,
            values: Object.fromEntries(Object.entries(values).filter(([v]) => v !== setting.default)),
          },
        };
      }
    }
  }
  return questions;
}

function settingQuestion(part: string, name: string, s: Setting): Question | undefined {
  switch (s.type) {
    case "choice":
      return { type: "choice", instructions: s.question ?? `Which ${name} does \`directive\` ask the ${part} to have?`, criteria: s.values };
    case "level": {
      const [first, second, ...rest] = Object.values(s.levels) as [string, string, ...string[]];
      return { type: "score", instructions: s.question ?? `How much ${name} does \`directive\` ask the ${part} to have?`, criteria: [first, second, ...rest] };
    }
    case "flag":
      return {
        type: "noul",
        instructions: s.question ?? `Does \`directive\` ask for the ${part} to be ${name}?`,
        ...(s.true || s.false ? { criteria: { ...(s.true ? { true: s.true } : {}), ...(s.false ? { false: s.false } : {}) } } : {}),
      };
    case "text":
    case "number":
      return undefined;
  }
}
