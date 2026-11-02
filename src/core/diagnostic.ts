// Lines and columns are 0-based, as in the language-server protocol.
// Everything Rubric reports is a warning: nothing it finds blocks the writer.

export type Code =
  | "unknown-part"
  | "unfinished-part"
  | "unfinished-setting"
  | "unknown-setting"
  | "duplicate-setting"
  | "value-not-allowed"
  | "bad-pin"
  | "unclosed-block"
  | "stray-closer"
  | "no-children"
  // A frame part (header, footer…) in a page, or a part for the writing in
  // rubric.md: each is chosen in its own place.
  | "wrong-place";

export interface Diagnostic {
  line: number;
  start: number;
  end: number;
  code: Code;
  message: string;
}
