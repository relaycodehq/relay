import { highlightingFor, language } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { highlightTree, tags } from "@lezer/highlight";
import type { Tree } from "@lezer/common";

/** A stretch of code and the editor's highlight classes for it. */
export type CodeRun = { text: string; className?: string };

const SCRIPTS = ["javascript", "typescript", "jsx", "tsx"];
/** Types TypeScript's parser names like any other, which JetBrains colours as keywords. */
export const PRIMITIVES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "object",
  "any",
  "unknown",
  "never",
  "undefined",
]);

/**
 * How the parser is to read a lone signature as the declaration it is: text
 * hidden around it, and a leading keyword it couldn't parse (TypeScript's
 * `constructor Name(…)`), shown as a keyword and left out of what it reads.
 */
type Reading = { before: string; after: string; lead: number };

function readingOf(languageName: string, code: string, member: boolean): Reading {
  if (languageName === "php") {
    return member
      ? { before: "<?php class _ {\n", after: "\n}", lead: 0 }
      : { before: "<?php\n", after: "", lead: 0 };
  }
  if (!SCRIPTS.includes(languageName)) return { before: "", after: "", lead: 0 };
  if (member) return { before: "class _ {\n", after: "\n}", lead: 0 };
  const keywordFirst = /^(?:constructor|new)\s+/.exec(code);
  if (keywordFirst) return { before: "function ", after: "", lead: keywordFirst[0].length };
  if (/^[\w$]+\s*[(<]/.test(code)) return { before: "function ", after: "", lead: 0 };
  if (/^[\w$]+\??\s*:/.test(code)) return { before: "let ", after: "", lead: 0 };
  return { before: "", after: "", lead: 0 };
}

/** `code` coloured as the editor colours its own text, in the editor's language. */
export function highlightRuns(state: EditorState, code: string, member: boolean): CodeRun[] {
  const parser = state.facet(language);
  if (!parser) return [{ text: code }];
  const { before, after, lead } = readingOf(parser.name, code, member);
  const read = code.slice(lead);
  const tree = parser.parser.parse(before + read + after);
  const start = before.length;
  const end = start + read.length;
  const keyword = highlightingFor(state, [tags.keyword]) ?? undefined;
  // One class per character of `code`, then joined into runs.
  const classes: (string | undefined)[] = new Array(code.length);
  const paint = (from: number, to: number, className: string | undefined) => {
    for (let at = Math.max(from, start); at < Math.min(to, end); at++)
      classes[at - start + lead] = className;
  };
  classes.fill(keyword, 0, lead);
  highlightTree(tree, { style: (found) => highlightingFor(state, found) }, paint, start, end);
  if (SCRIPTS.includes(parser.name)) {
    const source = before + read;
    for (const [from, to] of primitiveTypes(tree, source, start, end)) paint(from, to, keyword);
  }
  return runsOf(code, classes);
}

/** `code` read on its own and coloured as the editor colours its own text. */
export function codeRuns(state: EditorState, code: string): CodeRun[] {
  const parser = state.facet(language);
  if (!parser) return [{ text: code }];
  const classes: (string | undefined)[] = new Array(code.length);
  const paint = (from: number, to: number, className: string) => classes.fill(className, from, to);
  highlightTree(parser.parser.parse(code), { style: (found) => highlightingFor(state, found) }, paint);
  return runsOf(code, classes);
}

/** Where `string`, `number` and the like name a type. */
function primitiveTypes(tree: Tree, source: string, from: number, to: number) {
  const found: [number, number][] = [];
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "TypeName" && PRIMITIVES.has(source.slice(node.from, node.to)))
        found.push([node.from, node.to]);
    },
  });
  return found;
}

function runsOf(code: string, classes: (string | undefined)[]): CodeRun[] {
  const runs: CodeRun[] = [];
  for (let at = 0; at < code.length; at++) {
    const last = runs.at(-1);
    if (last && last.className === classes[at]) last.text += code[at];
    else runs.push({ text: code[at], className: classes[at] });
  }
  return runs;
}
