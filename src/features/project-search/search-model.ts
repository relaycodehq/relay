import type {
  ProjectSearchFile,
  ProjectSearchMatch,
  ProjectSearchResult,
} from "../../../shared/project-search";
import type { OpenTarget } from "./types";

export type ResultRow =
  | {
      kind: "file";
      file: ProjectSearchFile;
      /** Matches in the file, all of them. */
      count: number;
      collapsed: boolean;
      excluded: boolean;
    }
  | {
      kind: "line";
      file: ProjectSearchFile;
      first: ProjectSearchMatch;
      /** Every match on the line, as ranges in `first.preview`. */
      hits: { start: number; length: number }[];
      excluded: boolean;
    };

/**
 * The results as a flat list: a header per file, then a row per matching
 * line, several matches on one line sharing a row. A collapsed file shows its
 * header only.
 */
export function buildRows(
  files: readonly ProjectSearchFile[],
  collapsed: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const file of files) {
    const out = excluded.has(file.path);
    const fold = collapsed.has(file.path);
    rows.push({
      kind: "file",
      file,
      count: file.matches.length,
      collapsed: fold,
      excluded: out,
    });
    if (fold) continue;
    let last: Extract<ResultRow, { kind: "line" }> | undefined;
    for (const match of file.matches) {
      const range = {
        start: match.column - match.previewStart,
        length: match.length,
      };
      if (
        last &&
        last.first.line === match.line &&
        last.first.previewStart === match.previewStart
      ) {
        last.hits.push(range);
        continue;
      }
      last = { kind: "line", file, first: match, hits: [range], excluded: out };
      rows.push(last);
    }
  }
  return rows;
}

/** The files a replace would touch and the matches in them. */
export function replaceScope(
  files: readonly ProjectSearchFile[],
  excluded: ReadonlySet<string>,
) {
  const kept = files.filter((f) => !excluded.has(f.path));
  return {
    files: kept,
    matches: kept.reduce((n, f) => n + f.matches.length, 0),
  };
}

/** "42 matches in 7 files", with a plus when the search stopped at its cap. */
export function summary(
  files: readonly ProjectSearchFile[],
  truncated: boolean,
) {
  const matches = files.reduce((n, f) => n + f.matches.length, 0);
  const plus = truncated ? "+" : "";
  const one = (n: number) => n === 1 && !truncated;
  return `${matches}${plus} ${one(matches) ? "match" : "matches"} in ${files.length}${plus} ${one(files.length) ? "file" : "files"}`;
}

export const fileCount = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

/** The line under the query field: a problem, "Searching…", or how much was found and how fast. */
export function statusLine(input: {
  problem?: string;
  hasQuery: boolean;
  loading: boolean;
  result?: ProjectSearchResult;
}) {
  const { problem, hasQuery, loading, result } = input;
  if (problem) return problem;
  if (!hasQuery) return "";
  if (!result) return loading ? "Searching…" : "";
  const engineNote = result.engine === "node" ? " · without ripgrep" : "";
  return `${summary(result.files, result.truncated)} · ${result.elapsedMs}ms${engineNote}`;
}

/** What the results area says when it has no rows to show, if anything. */
export function emptyResultsNote(input: {
  hasQuery: boolean;
  rowCount: number;
  loading: boolean;
  problem?: string;
}) {
  if (!input.hasQuery) return "Type to search the project.";
  const noMatches = !input.rowCount && !input.loading && !input.problem;
  return noMatches ? "No matches." : undefined;
}

/** Where a result row takes the editor: a line row to its match, a file row to the file's first match. */
export function openTargetOf(
  row: ResultRow | undefined,
): OpenTarget | undefined {
  if (!row) return undefined;
  const match = row.kind === "line" ? row.first : row.file.matches[0];
  return { path: row.file.path, line: match.line, column: match.column };
}
