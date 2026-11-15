// A variant is a part's own drawing beside the part itself, made by changing
// it: `parts/quote--torn-edge/` in the site, placed by a line that sets
// `variant=torn-edge` on the part (`::: quote variant=torn-edge`). The part
// takes a `variant` setting listing them, so Jev picks one from words like
// any other setting; Hugo draws the variant by its own name.

import type { Catalog } from "./catalog.ts";
import type { PlainForm } from "./plain.ts";

// The setting, and its value for the part with no variant.
export const VARIANT = "variant";
export const PLAIN = "plain";
const SEP = "--";

export function variantName(part: string, variant: string): string {
  return `${part}${SEP}${variant}`;
}

// `quote--torn-edge` as the part it is a variant of and its own name.
export function splitVariant(name: string): { of: string; name: string } | undefined {
  const at = name.indexOf(SEP);
  if (at < 1 || at + SEP.length >= name.length) return undefined;
  return { of: name.slice(0, at), name: name.slice(at + SEP.length) };
}

// The part a placed line is drawn by: the variant it sets, or the one the
// site draws for every line of the part that sets none; the part itself
// for `plain`. The setting is Rubric's, so Hugo never sees it.
export function drawnForm(form: PlainForm, catalog: Catalog): PlainForm {
  const def = Object.hasOwn(catalog.parts, form.part) ? catalog.parts[form.part]!.settings[VARIANT] : undefined;
  if (def?.type !== "choice") return form.settings.some((s) => s.key === VARIANT) ? { ...form, settings: form.settings.filter((s) => s.key !== VARIANT) } : form;
  const value = form.settings.find((s) => s.key === VARIANT)?.value ?? def.default;
  const settings = form.settings.filter((s) => s.key !== VARIANT);
  return value === PLAIN ? { ...form, settings } : { ...form, part: variantName(form.part, value), settings };
}
