// The catalog file is the contract. Everything else reads it through these
// types, so a malformed catalog fails here, once, with the path to the problem.

import { readFile } from "node:fs/promises";
import { parse } from "yaml";

// Choice, level and flag settings are asked of Jev; `question` overrides the
// generated wording when it reads badly. Choice and level need a default,
// because an unsettled answer falls back to it. Text and number settings are
// never asked; they come from the plain form.
export type Setting =
  | { type: "choice"; default: string; values: Record<string, string>; question?: string }
  | { type: "level"; default: string; levels: Record<string, string>; question?: string }
  | { type: "flag"; default?: boolean; true?: string; false?: string; question?: string }
  | { type: "text"; default?: string }
  | { type: "number"; default?: number };

export interface Part {
  description: string;
  children: boolean;
  // The part brings a script, loaded only on pages that use it. The part
  // still works without it.
  script: boolean;
  settings: Record<string, Setting>;
}

export interface Catalog {
  name: string;
  version: number;
  slots: string[];
  parts: Record<string, Part>;
}

export class CatalogError extends Error {}

// Part, setting and value names end up in shortcode calls and CSS classes.
export const NAME = /^[a-z][a-z0-9-]*$/;

export async function loadCatalog(path: string): Promise<Catalog> {
  return parseCatalog(await readFile(path, "utf8"));
}

export function parseCatalog(text: string): Catalog {
  const raw = parse(text) as unknown;
  const root = record(raw, "catalog");
  const name = string(root.name, "name");
  const version = root.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new CatalogError("version must be a whole number from 1");
  }
  const slots = root.slots === undefined ? [] : array(root.slots, "slots").map((s, i) => string(s, `slots[${i}]`));

  const parts: Record<string, Part> = {};
  for (const [partName, rawPart] of Object.entries(record(root.parts, "parts"))) {
    const at = `parts.${partName}`;
    named(partName, at);
    const part = record(rawPart, at);
    const children = part.children ?? false;
    if (typeof children !== "boolean") throw new CatalogError(`${at}.children must be true or false`);
    const script = part.script ?? false;
    if (typeof script !== "boolean") throw new CatalogError(`${at}.script must be true or false`);
    const settings: Record<string, Setting> = {};
    for (const [settingName, rawSetting] of Object.entries(record(part.settings ?? {}, `${at}.settings`))) {
      named(settingName, `${at}.settings.${settingName}`);
      settings[settingName] = setting(rawSetting, `${at}.settings.${settingName}`);
    }
    parts[partName] = { description: string(part.description, `${at}.description`), children, script, settings };
  }
  if (Object.keys(parts).length === 0) throw new CatalogError("parts must name at least one part");

  return { name, version, slots, parts };
}

function setting(raw: unknown, at: string): Setting {
  const s = record(raw, at);
  const question = s.question === undefined ? {} : { question: string(s.question, `${at}.question`) };
  switch (s.type) {
    case "choice":
    case "level": {
      const key = s.type === "choice" ? "values" : "levels";
      const values = record(s[key], `${at}.${key}`);
      const names = Object.keys(values);
      if (names.length < 2) throw new CatalogError(`${at}.${key} needs at least two`);
      for (const v of names) {
        named(v, `${at}.${key}.${v}`);
        string(values[v], `${at}.${key}.${v}`);
      }
      if (s.default === undefined || !names.includes(String(s.default))) {
        throw new CatalogError(`${at}.default must be one of ${names.join(", ")}`);
      }
      const def = String(s.default);
      return s.type === "choice"
        ? { type: "choice", default: def, values: values as Record<string, string>, ...question }
        : { type: "level", default: def, levels: values as Record<string, string>, ...question };
    }
    case "flag": {
      if (s.default !== undefined && typeof s.default !== "boolean") throw new CatalogError(`${at}.default must be true or false`);
      return {
        type: "flag",
        ...question,
        ...(s.default === undefined ? {} : { default: s.default }),
        ...(s.true === undefined ? {} : { true: string(s.true, `${at}.true`) }),
        ...(s.false === undefined ? {} : { false: string(s.false, `${at}.false`) }),
      };
    }
    case "text":
      return { type: "text", ...(s.default === undefined ? {} : { default: string(s.default, `${at}.default`) }) };
    case "number":
      if (s.default !== undefined && typeof s.default !== "number") throw new CatalogError(`${at}.default must be a number`);
      return { type: "number", ...(s.default === undefined ? {} : { default: s.default }) };
    default:
      throw new CatalogError(`${at}.type must be choice, level, flag, text or number`);
  }
}

function record(v: unknown, at: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new CatalogError(`${at} must be a mapping`);
  return v as Record<string, unknown>;
}

function array(v: unknown, at: string): unknown[] {
  if (!Array.isArray(v)) throw new CatalogError(`${at} must be a list`);
  return v;
}

function string(v: unknown, at: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new CatalogError(`${at} must be text`);
  return v;
}

function named(name: string, at: string): void {
  if (!NAME.test(name)) throw new CatalogError(`${at}: names are lowercase letters, digits and hyphens`);
}
