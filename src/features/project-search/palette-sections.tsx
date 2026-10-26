import type { ReactNode } from "react";
import type { ProjectSearchFile } from "../../../shared/project-search";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import type { FileQuery, FuzzyMatch } from "./fuzzy";
import { Highlight } from "./Highlight";
import { PathLabel } from "./PathLabel";
import type { OpenTarget, SearchMode, SearchSymbol } from "./types";

/** Rows each section shows under All; the rest is one Tab away. */
const PREVIEW_ROWS = 6;
export const FILE_ROWS = 100;
export const TEXT_ROWS = 300;
const RECENT_ROWS = 12;

export interface Row {
  key: string;
  target: OpenTarget;
  body: ReactNode;
}

export interface Section {
  id: "files" | "text" | "symbols";
  label: string;
  rows: Row[];
  busy?: boolean;
  /** The rows hidden under All. */
  more?: number;
}

const previewing = (mode: SearchMode) => mode === "all";

function fileRow(hit: FuzzyMatch, jump: FileQuery): Row {
  return {
    key: `file:${hit.path}`,
    target: { path: hit.path, line: jump.line, column: jump.column },
    body: (
      <>
        <PathLabel path={hit.path} indices={hit.indices} />
        {jump.line !== undefined && (
          <span className="ps-trail">line {jump.line}</span>
        )}
      </>
    ),
  };
}

function goToLineRow(path: string, line: number, column?: number): Row {
  return {
    key: "line",
    target: { path, line, column },
    body: (
      <>
        <PathLabel path={path} showDir={false} />
        <span className="ps-trail">go to line {line}</span>
      </>
    ),
  };
}

function recentRow(path: string): Row {
  return {
    key: `recent:${path}`,
    target: { path },
    body: <PathLabel path={path} />,
  };
}

/**
 * The files section: fuzzy hits for a typed name, the active file's line for
 * a bare `:42`, and the recent files while the box is empty.
 */
export function filesSection(input: {
  mode: SearchMode;
  jump: FileQuery;
  fileHits: FuzzyMatch[];
  recent: string[];
  activePath?: string;
}): Section {
  const { mode, jump, fileHits, recent, activePath } = input;
  const preview = previewing(mode);
  if (jump.text) {
    const shown = fileHits.slice(0, preview ? PREVIEW_ROWS : FILE_ROWS);
    return {
      id: "files",
      label: "Files",
      rows: shown.map((hit) => fileRow(hit, jump)),
      more: preview ? fileHits.length - shown.length : 0,
    };
  }
  if (jump.line !== undefined && activePath) {
    const row = goToLineRow(activePath, jump.line, jump.column);
    return { id: "files", label: "Files", rows: [row], more: 0 };
  }
  const shown = recent.slice(0, preview ? PREVIEW_ROWS : RECENT_ROWS);
  const hidden = Math.max(
    0,
    Math.min(recent.length, RECENT_ROWS) - shown.length,
  );
  return {
    id: "files",
    label: "Recent files",
    rows: shown.map(recentRow),
    more: preview ? hidden : 0,
  };
}

/** One row per matching line, up to `limit`; `total` counts the lines past it too. */
function textRows(files: readonly ProjectSearchFile[], limit: number) {
  const rows: Row[] = [];
  let total = 0;
  for (const file of files) {
    let previousLine = 0;
    for (const match of file.matches) {
      // Several hits on a line are one row.
      if (match.line === previousLine) continue;
      previousLine = match.line;
      total++;
      if (rows.length >= limit) continue;
      rows.push({
        key: `text:${file.path}:${match.line}`,
        target: { path: file.path, line: match.line, column: match.column },
        body: (
          <>
            <FileEntryIcon path={file.path} directory={false} />
            <span className="ps-code">
              <Highlight
                text={match.preview}
                ranges={[
                  {
                    start: match.column - match.previewStart,
                    length: match.length,
                  },
                ]}
              />
            </span>
            <span className="ps-where">
              {file.path}:{match.line}
            </span>
          </>
        ),
      });
    }
  }
  return { rows, total };
}

export function textSection(
  mode: SearchMode,
  files: readonly ProjectSearchFile[] | undefined,
  busy: boolean,
): Section {
  const preview = previewing(mode);
  const { rows, total } = textRows(
    files ?? [],
    preview ? PREVIEW_ROWS : TEXT_ROWS,
  );
  return {
    id: "text",
    label: "Text in files",
    rows,
    busy,
    more: preview ? total - rows.length : 0,
  };
}

export function symbolsSection(
  mode: SearchMode,
  symbols: SearchSymbol[],
  busy: boolean,
): Section {
  const preview = previewing(mode);
  const rows = symbols
    .slice(0, preview ? PREVIEW_ROWS : FILE_ROWS)
    .map((symbol, i): Row => ({
      key: `sym:${i}:${symbol.path}:${symbol.line}:${symbol.name}`,
      target: { path: symbol.path, line: symbol.line, column: symbol.column },
      body: (
        <>
          <span className="ps-kind">{symbol.kind ?? ""}</span>
          <span className="ps-name">{symbol.name}</span>
          <span className="ps-dir">
            {[symbol.container, symbol.path].filter(Boolean).join("  ·  ")}
          </span>
        </>
      ),
    }));
  return {
    id: "symbols",
    label: "Symbols",
    rows,
    busy,
    more: preview ? symbols.length - rows.length : 0,
  };
}
