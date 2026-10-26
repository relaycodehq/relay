import type { ProjectSearchQuery } from "../../shared/project-search";

type Pattern = Pick<
  ProjectSearchQuery,
  "pattern" | "regex" | "caseSensitive" | "wholeWord"
>;

// No `-`: it means nothing outside a class, and Unicode mode refuses `\-`.
const escapeForRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** V8's "Invalid regular expression: /(/: Unterminated group" without the pattern in the middle. */
function patternProblem(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const reason = text.split(": ").at(-1) ?? text;
  return `Invalid regular expression: ${reason}.`;
}

/**
 * The pattern as one global JavaScript RegExp. Whole-word matches take a
 * match only where no letter, digit or underscore touches it, which is what
 * `rg -w` does and also holds for a pattern that starts or ends in a symbol.
 */
export function searchRegExp(query: Pattern): RegExp {
  const source = query.regex ? query.pattern : escapeForRegExp(query.pattern);
  const build = (unicode: boolean) => {
    const word = unicode ? "[\\p{L}\\p{N}_]" : "[A-Za-z0-9_]";
    const body = query.wholeWord
      ? `(?<!${word})(?:${source})(?!${word})`
      : source;
    return new RegExp(
      body,
      "g" + (query.caseSensitive ? "" : "i") + (unicode ? "u" : ""),
    );
  };
  try {
    return build(true);
  } catch (e) {
    // Unicode mode refuses escapes like `\-` that other engines take.
    try {
      return build(false);
    } catch {
      throw new Error(patternProblem(e));
    }
  }
}

/**
 * Moves `re` past an empty match at `at`. In Unicode mode that is a whole
 * surrogate pair: stopping inside one makes `exec` match at its start again.
 */
function stepPastEmpty(re: RegExp, line: string, at: number) {
  const pair = re.unicode && (line.codePointAt(at) ?? 0) > 0xffff;
  re.lastIndex = at + (pair ? 2 : 1);
}

export interface Hit {
  index: number;
  length: number;
}

/** Where the pattern matches in one line. Empty matches (`^`, `a*`) are no hit. */
export function hitsIn(re: RegExp, line: string): Hit[] {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m[0] === "") stepPastEmpty(re, line, m.index);
    else hits.push({ index: m.index, length: m[0].length });
  }
  return hits;
}

/** What `$1`, `$<name>`, `$&` and `$$` in a replacement stand for. */
function expand(replacement: string, m: RegExpExecArray) {
  return replacement.replace(
    /\$(\$|&|\d{1,2}|<[^>]*>)/g,
    (whole, token: string) => {
      if (token === "$") return "$";
      if (token === "&") return m[0];
      if (token.startsWith("<")) return m.groups?.[token.slice(1, -1)] ?? whole;
      const n = Number(token);
      // `$12` with only 9 groups is `$1` followed by a 2, as in String.replace.
      if (n >= 1 && n < m.length) return m[n] ?? "";
      if (token.length === 2 && Number(token[0]) < m.length)
        return (m[Number(token[0])] ?? "") + token[1];
      return whole;
    },
  );
}

/**
 * `line` with every match replaced and how many there were. A plain query
 * puts the replacement in as typed; a regex one expands its `$` references.
 */
export function replaceInLine(
  re: RegExp,
  line: string,
  replacement: string,
  regex: boolean,
) {
  let count = 0;
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m[0] === "") {
      stepPastEmpty(re, line, m.index);
      continue;
    }
    count++;
    out +=
      line.slice(last, m.index) +
      (regex ? expand(replacement, m) : replacement);
    last = m.index + m[0].length;
  }
  return { text: count ? out + line.slice(last) : line, count };
}

/** The text with the pattern replaced line by line, so a match never spans lines as a search never does. */
export function replaceInText(
  re: RegExp,
  text: string,
  replacement: string,
  regex: boolean,
) {
  let count = 0;
  // The terminators stay with their lines, \r\n and a missing last one included.
  const next = text.split(/(\r?\n)/).map((part, i) => {
    if (i % 2) return part;
    const done = replaceInLine(re, part, replacement, regex);
    count += done.count;
    return done.text;
  });
  return { text: next.join(""), count };
}
