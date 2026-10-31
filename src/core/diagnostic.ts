// Lines and columns are 0-based, as in the language-server protocol.
// Everything Rubric reports is a warning: nothing it finds blocks the writer.

export type Code =
  | "unknown-part"
  | "unknown-setting"
  | "duplicate-setting"
  | "value-not-allowed"
  | "bad-pin"
  | "unclosed-block"
  | "stray-closer"
  | "no-children";

export interface Diagnostic {
  line: number;
  start: number;
  end: number;
  code: Code;
  message: string;
}
