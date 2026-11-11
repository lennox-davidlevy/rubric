// Lines and columns are 0-based, as in the language-server protocol.
// Everything Rubric reports is a warning: nothing it finds blocks the writer.

export type Code =
  | "unknown-part"
  | "unfinished-part"
  | "unfinished-setting"
  | "unknown-setting"
  | "duplicate-setting"
  | "value-not-allowed"
  | "unclosed-block"
  | "stray-closer"
  | "no-children"
  // A frame part (header, footer…) in a page, or a part for the writing in
  // rubric.md: each is chosen in its own place.
  | "wrong-place"
  // A part or setting another skin adds: kept, not drawn, never an error.
  | "other-skin"
  // A `::: theme` line with no theme chosen yet: the list opens on it.
  | "theme-unpicked"
  // A second `::: theme` line in rubric.md; the first is the one used.
  | "second-theme"
  // Front matter that does not parse, as while a line of it is half typed.
  | "bad-front-matter";

export interface Diagnostic {
  line: number;
  start: number;
  end: number;
  code: Code;
  message: string;
}
