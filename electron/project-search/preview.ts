import type { ProjectSearchMatch } from "../../shared/project-search";

/** Longest stretch of a line kept; a minified bundle's one line would otherwise ride along in full. */
const previewMax = 240;
/** Characters kept before a match that is far into its line. */
const lead = 40;

/** The line without its terminator, `\n`, `\r\n` or a last line's `\r`. */
export function withoutLineEnd(line: string) {
  let text = line;
  if (text.endsWith("\r\n")) text = text.slice(0, -2);
  else if (text.endsWith("\n")) text = text.slice(0, -1);
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

/**
 * A match as the results show it: the line (already `withoutLineEnd`) without
 * its indentation, and for a long line only a window around the match.
 */
export function matchPreview(
  text: string,
  number: number,
  column: number,
  length: number,
): ProjectSearchMatch {
  let start = Math.min(text.length - text.trimStart().length, column);
  if (column - start > lead + 20) start = column - lead;
  const end = Math.min(
    text.length,
    Math.max(start + previewMax, column + Math.min(length, previewMax)),
  );
  return {
    line: number,
    column,
    length,
    preview: text.slice(start, end),
    previewStart: start,
  };
}
