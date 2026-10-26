// How long each named function is: declarations, methods, and functions
// assigned to a name, React components among them. Files are formatted by
// Prettier, so a function ends at the first closer back at its own indent
// that doesn't open again, as `) {` after a long parameter list does.

const declared =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)/;
const assigned =
  /^\s*(?:export\s+)?(?:const|let)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:[\w$.]+\()?(?:async\s+)?(?:function\b|\([^)]*$|\(.*\)\s*(?::[^=]+)?=>\s*[{(]?\s*$|[\w$]+\s*=>\s*[{(]?\s*$)/;
const method =
  /^\s*(?:(?:public|private|protected|static|readonly|override|async|get|set)\s+)*\*?(#?[\w$]+)\s*(?:<[^>]*>)?\(/;
const notMethods = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "with",
]);

const closer = /^\s*[}\])]/;
const opensAgain = /([{([,=?:|&<]|=>)\s*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;

/** The line a function starting at `start` ends on, or -1 when it has no body there. */
function endOf(lines: string[], start: number) {
  const level = indentOf(lines[start]);
  if (!opensAgain.test(lines[start])) return -1;
  let end = -1;
  for (let next = start + 1; next < lines.length; next++) {
    const text = lines[next];
    if (!text.trim() || indentOf(text) > level) continue;
    if (indentOf(text) < level || !closer.test(text)) break;
    end = next;
    if (!opensAgain.test(text)) break;
  }
  return end;
}

/** Whether the method-looking line at `start` declares one, rather than calling it. */
function declaresMethod(lines: string[], start: number, end: number) {
  const first = lines[start].trimEnd();
  if (/=>\s*\{$/.test(first) || /^\s*(await|return|yield|new)\b/.test(first))
    return false;
  if (/\)\s*(:[^=]+)?\{$/.test(first)) return true;
  // A long parameter list ends `) {` or `): Type {` back at its indent.
  if (!first.endsWith("(")) return false;
  for (let line = start + 1; line <= end; line++) {
    const text = lines[line];
    if (indentOf(text) === indentOf(first) && closer.test(text))
      return /^\s*\)(\s*:[^=]+)?\s*\{$/.test(text);
  }
  return false;
}

/** Each named function's length in lines; a name used twice keeps the longer. */
export function functionLengths(text: string) {
  const lines = text.split("\n");
  const lengths = new Map<string, number>();
  for (let start = 0; start < lines.length; start++) {
    const line = lines[start];
    let name = declared.exec(line)?.[1] ?? assigned.exec(line)?.[1];
    const end = endOf(lines, start);
    if (end < 0) continue;
    if (!name) {
      const called = method.exec(line)?.[1];
      if (!called || notMethods.has(called)) continue;
      if (!declaresMethod(lines, start, end)) continue;
      name = called;
    }
    const length = end - start + 1;
    lengths.set(name, Math.max(length, lengths.get(name) ?? 0));
  }
  return lengths;
}
