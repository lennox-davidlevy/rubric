// Everything Rubric says to Jev, and the thresholds it reads the answers by.
// The questions are generated from the catalog file; this module holds the
// only wording that lives outside it, so this is where tuning happens.

import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "@typesafe-ai/sdk";
import { settingsOf, type Catalog, type Setting } from "./catalog.ts";

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
  // How sure the part Choice itself is. A pick is placed on a clear fit only
  // when the Choice gives it at least a majority; a split Choice means the
  // line could be either, so both are offered. When the Choice is this sure,
  // a weaker fit is enough to place it; a fit below `no` is still nothing.
  // Found on the universal catalog's probe (docs/lsp.md): writers' lines
  // rarely say every word of a description, so fits sat between 0.4 and 0.7
  // for parts the Choice was all but certain of.
  majority: 0.5,
  sure: 0.9,
  fitsWhenSure: 0.4,
  // ...but only in a catalog with at least this many parts to choose from.
  // In a small one the Choice is sure of the closest part even when the
  // line asks for something the catalog lacks: against the 11-part blog
  // catalog, a flowchart came back figure and a PDF buttons, Choice over 0.9
  // and fit 0.4 to 0.7, the same fits as right parts held back in the
  // universal catalog. The Choice's confidence means something only when it
  // had many alternatives.
  sureFrom: 15,
};

// "site" is rubric.md, where the frame around every page is chosen.
export type PageKind = "home" | "post" | "page" | "site";

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
export const toldId = (part: string, setting: string) => `told:${part}:${setting}`;
// The look settings are the same for every part, so they are asked once a
// line, not once a part.
export const lookId = (setting: string) => `look:${setting}`;
export const lookSaidId = (setting: string) => `look-said:${setting}`;
export const BEYOND = "beyond";

export function buildState(directive: string, page: PageKind): State {
  return { directive, page };
}

// The second pass: words after a pinned part's ":", such as "a bit bigger,
// with a shadow". The part is known, so only its settings are asked, and the
// state says which part the words are about.
export type RefineState = {
  directive: string;
  page: PageKind;
  part: string;
};

export function refineState(words: string, page: PageKind, part: string, description: string): RefineState {
  return { directive: words, page, part: `${part}: ${description}` };
}

// Words after the ":" are read as a whole. For each setting: does the line
// say anything about it, the default included, so "back to normal width"
// counts; and if so, which value. Then whether the line asks for anything no
// setting covers, which the editor says rather than quietly ignores.
export function refineQuestions(catalog: Catalog, partName: string): Record<string, Question> {
  const questions: Record<string, Question> = {};
  const covers: Record<string, string> = {};
  for (const [name, setting] of Object.entries(settingsOf(catalog, partName))) {
    const q = settingQuestion(partName, name, setting);
    if (!q) continue;
    questions[settingId(partName, name)] = q;
    const values =
      setting.type === "choice" ? setting.values
      : setting.type === "level" ? setting.levels
      : setting.type === "flag" ? { yes: setting.true ?? `the ${partName} is ${name}`, no: setting.false ?? `the ${partName} is not ${name}` }
      : {};
    covers[name] = Object.values(values).join("; ");
    questions[toldId(partName, name)] = {
      type: "noul",
      instructions: { question: `Does \`directive\` say how the \`part\` should be, for its ${name}?`, values },
    };
  }
  questions[BEYOND] = {
    type: "noul",
    instructions: {
      question: "Does `directive` ask for something about the `part` that none of these settings can do?",
      settings: Object.keys(covers).length ? covers : { none: "it has no settings" },
    },
  };
  return questions;
}

// Which part `directive` asks for: one Choice among the catalog's parts.
export function partQuestion(catalog: Catalog): Record<string, Question> {
  const parts = Object.fromEntries(Object.entries(catalog.parts).map(([name, p]) => [name, p.description]));
  return {
    [PART]: {
      type: "choice",
      instructions: "Which part of a web page does `directive` ask for?",
      criteria: parts,
    },
  };
}

// For each of `parts`: whether it fits, and for each asked setting, whether
// the line says anything about it and what.
export function detailQuestions(catalog: Catalog, parts: readonly string[]): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (const partName of parts) {
    const part = catalog.parts[partName]!;
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

// How the line asks the part to look: for each look setting, whether the
// line asks for anything other than the default, and which value. Asked
// once a line, whatever the part.
export function lookQuestions(catalog: Catalog): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (const [name, setting] of Object.entries(catalog.look)) {
    if (setting.type !== "choice") continue;
    questions[lookId(name)] = { type: "choice", instructions: setting.question ?? `Which ${name} does \`directive\` ask for?`, criteria: setting.values };
    questions[lookSaidId(name)] = {
      type: "noul",
      instructions: {
        question: `Does \`directive\` ask for one of these ${name} values?`,
        values: Object.fromEntries(Object.entries(setting.values).filter(([v]) => v !== setting.default)),
      },
    };
  }
  return questions;
}

// One request per directive line, every question speculative: which part,
// the details of every part, and the look. Code reads only what belongs to
// the part it picks. Its size grows with the catalog; `ask` in two steps
// does not.
export function buildQuestions(catalog: Catalog): Record<string, Question> {
  return { ...partQuestion(catalog), ...detailQuestions(catalog, Object.keys(catalog.parts)), ...lookQuestions(catalog) };
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
    case "image":
      return undefined;
  }
}
