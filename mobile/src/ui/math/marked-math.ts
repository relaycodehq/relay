import type { Tokens, TokenizerExtension } from "marked";

// marked has no math. Text goes through shared/math-delimiters first, which
// leaves display formulas as `$$` lines and inline ones as `$$x$$`; these two
// extensions turn those into tokens. Types only from marked, so a test can run
// them without the phone's dependencies.

export interface MathToken extends Tokens.Generic {
  type: "math";
  raw: string;
  text: string;
  /** False while the formula's closing `$$` hasn't arrived. */
  closed: boolean;
}
export interface InlineMathToken extends Tokens.Generic {
  type: "inlineMath";
  raw: string;
  text: string;
}

const OPEN = /^ {0,3}\$\$[ \t]*(?:\n|$)/;
const CLOSE = /^ {0,3}\$\$[ \t]*(?:\n|$)/m;

export function matchBlockMath(src: string): MathToken | undefined {
  const open = OPEN.exec(src);
  if (!open) return undefined;
  const rest = src.slice(open[0].length);
  const close = CLOSE.exec(rest);
  const body = close ? rest.slice(0, close.index) : rest;
  return {
    type: "math",
    raw: open[0] + (close ? rest.slice(0, close.index + close[0].length) : rest),
    text: body.replace(/\n$/, ""),
    closed: !!close,
  };
}

export function matchInlineMath(src: string): InlineMathToken | undefined {
  const match = /^\$\$([^\n]+?)\$\$/.exec(src);
  return match
    ? { type: "inlineMath", raw: match[0], text: match[1]!.trim() }
    : undefined;
}

export const mathExtensions: TokenizerExtension[] = [
  {
    name: "math",
    level: "block",
    start: (src) => src.search(/^ {0,3}\$\$[ \t]*(?:\n|$)/m) >= 0
      ? src.search(/^ {0,3}\$\$[ \t]*(?:\n|$)/m)
      : undefined,
    tokenizer: (src) => matchBlockMath(src),
  },
  {
    name: "inlineMath",
    level: "inline",
    start: (src) => (src.includes("$$") ? src.indexOf("$$") : undefined),
    tokenizer: (src) => matchInlineMath(src),
  },
];
