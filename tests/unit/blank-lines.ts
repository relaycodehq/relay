// Where a blank line is missing between two things you read one at a time:
// statements at the top of a file and a class's members, wherever one of the
// two spans several lines, and a test file's blocks. Files are formatted by
// Prettier, so indentation tells the levels apart without a parser.

const opensAgain = /([{([,=?:|&<]|=>)\s*$/;
const closer = /^\s*[}\])]/;
const comment = /^\s*(\/\/|\/\*|\*)/;
const testBlock =
  /^\s*(it|test|describe|beforeEach|afterEach|beforeAll|afterAll)(\.\w+)*\(/;
const classHeader =
  /^\s*(?:(?:export|default|abstract|declare)\s+)*class\s+[\w$]+.*\{\s*$|=\s*class\b.*\{\s*$/;
const anImport = /^(import\b|export\s+(type\s+)?(\*|\{)[^=]*$)/;

const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * For each line, whether it starts inside a template literal or a block
 * comment, where a blank line would change the text. Strings and regular
 * expressions end with their line, so a stray quote in JSX text can't run on.
 */
function insideText(lines: string[]) {
  const inside: boolean[] = [];
  let mode: "code" | "template" | "comment" = "code";
  // The brace depth each open `${` closes at, innermost last.
  const holes: number[] = [];
  let depth = 0;
  for (const line of lines) {
    inside.push(mode !== "code");
    let previous = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (mode === "comment") {
        if (c === "*" && line[i + 1] === "/") {
          mode = "code";
          i++;
        }
        continue;
      }
      if (mode === "template") {
        if (c === "\\") i++;
        else if (c === "`") mode = "code";
        else if (c === "$" && line[i + 1] === "{") {
          holes.push(depth++);
          mode = "code";
          i++;
        }
        continue;
      }
      if (c === "/" && line[i + 1] === "/") break;
      if (c === "/" && line[i + 1] === "*") {
        mode = "comment";
        i++;
        continue;
      }
      const regex = c === "/" && /^$|[(,=:[!&|?{};]/.test(previous);
      if (c === '"' || c === "'" || regex) {
        for (i++; i < line.length && line[i] !== c; i++)
          if (line[i] === "\\") i++;
        previous = c;
        continue;
      }
      if (c === "`") mode = "template";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (holes.at(-1) === depth) {
          holes.pop();
          mode = "template";
        }
      }
      if (c.trim()) previous = c;
    }
  }
  return inside;
}

type Statement = {
  /** Its first line, counting the comments above it. */
  start: number;
  declaration: string;
  end: number;
  multiLine: boolean;
};

/** The statements or members that start at `level`, from `first` until something less indented. */
function statementsOf(
  lines: string[],
  inside: boolean[],
  first: number,
  level: number,
) {
  const statements: Statement[] = [];
  let line = first;
  while (line < lines.length) {
    const text = lines[line];
    if (!text.trim() || inside[line] || indentOf(text) > level) {
      line++;
      continue;
    }
    if (indentOf(text) < level) break;
    let declaration = line;
    while (
      declaration < lines.length - 1 &&
      (comment.test(lines[declaration]) || /^\s*@/.test(lines[declaration]))
    )
      declaration++;
    // Comments with nothing right under them stand on their own.
    const after = lines[declaration];
    if (declaration > line && (!after.trim() || indentOf(after) < level)) {
      statements.push({
        start: line,
        declaration: lines[line].trim(),
        end: declaration - 1,
        multiLine: false,
      });
      line = declaration;
      continue;
    }
    // It goes on over deeper lines, and over closers that open again: `) {`.
    let end = declaration;
    for (let next = declaration + 1; next < lines.length; next++) {
      const t = lines[next];
      if (!t.trim() || inside[next] || indentOf(t) > level) continue;
      if (indentOf(t) === level && closer.test(t)) {
        end = next;
        if (opensAgain.test(t)) continue;
      }
      break;
    }
    statements.push({
      start: line,
      declaration: lines[declaration].trim(),
      end,
      multiLine: end > declaration,
    });
    line = end + 1;
  }
  return statements;
}

/** A function's name, to keep an overload's signatures with its body. */
const nameOf = (declaration: string) =>
  /^(?:(?:export|default|declare|async|function|public|private|protected|static|readonly|override|abstract)\s+)*([\w$]+)\s*[<(]/.exec(
    declaration,
  )?.[1];

function belongTogether(before: Statement, after: Statement) {
  if (anImport.test(before.declaration) && anImport.test(after.declaration))
    return true;
  const signature = !before.multiLine && before.declaration.endsWith(";");
  const name = nameOf(before.declaration);
  return signature && !!name && name === nameOf(after.declaration);
}

/** Lines that should have a blank line above them, 0-based. */
export function missingBlankLines(text: string, testFile: boolean): number[] {
  const lines = text.split("\n");
  const inside = insideText(lines);
  const missing = new Set<number>();
  const spaceOut = (statements: Statement[]) => {
    for (let i = 1; i < statements.length; i++) {
      const [before, after] = [statements[i - 1], statements[i]];
      const packed = after.start === before.end + 1;
      const long = before.multiLine || after.multiLine;
      if (packed && long && !belongTogether(before, after))
        missing.add(after.start);
    }
  };

  spaceOut(statementsOf(lines, inside, 0, 0));
  for (let header = 0; header < lines.length; header++) {
    if (inside[header] || !classHeader.test(lines[header])) continue;
    const body = lines.slice(header + 1).find((line) => line.trim());
    const level = body ? indentOf(body) : 0;
    if (level > indentOf(lines[header]))
      spaceOut(statementsOf(lines, inside, header + 1, level));
  }
  // A test block gets one above it too, unless it opens its describe.
  if (testFile)
    for (let at = 1; at < lines.length; at++) {
      if (inside[at] || !testBlock.test(lines[at])) continue;
      let start = at;
      while (start > 0 && comment.test(lines[start - 1])) start--;
      const above = lines[start - 1] ?? "";
      // Not one that is the body of a braceless `if` above it.
      const sibling = indentOf(above) >= indentOf(lines[at]);
      if (above.trim() && sibling && !/([{(]|=>)\s*$/.test(above))
        missing.add(start);
    }
  return [...missing].sort((a, b) => a - b);
}

/** `text` with a blank line added wherever one is missing. */
export function withBlankLines(text: string, testFile: boolean) {
  const lines = text.split("\n");
  for (const at of missingBlankLines(text, testFile).reverse())
    lines.splice(at, 0, "");
  return lines.join("\n");
}
