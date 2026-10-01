type Position = { line: number; character: number };

/**
 * What Enter inserts at `at`: the line's indentation, one more level after an
 * opening bracket, and the closing bracket on its own line when it follows.
 * The level is a tab when any line starts with one, else the file's narrowest
 * space indent, at most four.
 */
export function indentedNewline(text: string, at: Position) {
  const lines = text.split(/\r?\n/);
  const current = lines[at.line] ?? "";
  const indent = current.match(/^[\t ]*/)?.[0] ?? "";
  const unit = lines.some((v) => v.startsWith("\t"))
    ? "\t"
    : " ".repeat(
        lines.reduce(
          (width, value) =>
            Math.min(width, value.match(/^( +)\S/)?.[1].length ?? width),
          4,
        ),
      );
  const before = current.slice(0, at.character);
  const after = current.slice(at.character);
  const extra = /[\{\[(]\s*$/.test(before) ? unit : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return {
    text:
      eol +
      indent +
      extra +
      (extra && /^\s*[}\])]/.test(after) ? eol + indent : ""),
    caret: { line: at.line + 1, character: (indent + extra).length },
  };
}
