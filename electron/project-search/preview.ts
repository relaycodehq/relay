import type { ProjectSearchMatch } from "../../shared/project-search";

/** Longest stretch of a line kept; a minified bundle's one line would otherwise ride along in full. */
const previewMax = 240;
/** Characters kept before a match that is far into its line. */
const lead = 40;

/**
 * A match as the results show it: the line without its indentation, and for
 * a long line only a window around the match.
 */
export function matchPreview(
  line: string,
  number: number,
  column: number,
  length: number,
): ProjectSearchMatch {
  const text = line.replace(/\r?\n$/, "").replace(/\r$/, "");
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
