import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../../../shared/error-message";
import { api } from "../../lib/api";
import { PathIndex, parseFileQuery } from "./fuzzy";
import { sectionsShownIn } from "./palette-modes";
import {
  FILE_ROWS,
  filesSection,
  symbolsSection,
  TEXT_ROWS,
  textSection,
  type Row,
  type Section,
} from "./palette-sections";
import { useSearchQuery, type SearchFlags } from "./search-options";
import type { SearchMode, SearchSymbol } from "./types";
import { useProjectSearch } from "./useProjectSearch";
import { useSymbolSearch } from "./useSymbolSearch";

const SLOT = "palette";
/** Text goes to ripgrep once there is enough of it to mean something. */
const TEXT_MIN_CHARS = 2;
const TEXT_DELAY_MS = 180;
const flagsOff: SearchFlags = {
  regex: false,
  caseSensitive: false,
  wholeWord: false,
};

/** The file list, fuzzy-ranked against what was typed, and the line it may name. */
function useFileHits(where: string, text: string) {
  const fileList = useQuery({
    queryKey: ["project-search-files", where],
    queryFn: () => api.projectFiles(where),
    staleTime: 15_000,
  });
  const index = useMemo(
    () => (fileList.data ? new PathIndex(fileList.data) : undefined),
    [fileList.data],
  );
  const jump = useMemo(() => parseFileQuery(text), [text]);
  const fileHits = useMemo(
    () => (index && jump.text ? index.rank(jump.text, FILE_ROWS) : []),
    [index, jump.text],
  );
  return { fileList, jump, fileHits };
}

/**
 * Everything the Search Everywhere list shows for `text` in `mode`: the
 * sections, their rows as one list, and whether the file list, text search
 * or symbol lookup are still working.
 */
export function usePaletteResults(input: {
  where: string;
  mode: SearchMode;
  text: string;
  flags: SearchFlags;
  recent: string[];
  activePath?: string;
  symbols?: (query: string) => Promise<SearchSymbol[]>;
}) {
  const { where, mode, text, flags, recent, activePath, symbols } = input;
  const shown = sectionsShownIn(mode, !!symbols);
  const { fileList, jump, fileHits } = useFileHits(where, text);
  // A file name with a line number (`Foo.ts:42`) is never searched as text.
  const textQuery = useSearchQuery(
    shown.text && jump.line === undefined ? text : "",
    mode === "text" ? flags : flagsOff,
    { limit: mode === "text" ? TEXT_ROWS * 2 : 120 },
    TEXT_MIN_CHARS,
  );
  const found = useProjectSearch(where, textQuery, SLOT, TEXT_DELAY_MS);
  const symbolLookup = useSymbolSearch(symbols, shown.symbols, text);

  const sections = useMemo(() => {
    const out: Section[] = [];
    if (shown.files)
      out.push(filesSection({ mode, jump, fileHits, recent, activePath }));
    if (shown.text && textQuery)
      out.push(textSection(mode, found.result?.files, found.loading));
    if (shown.symbols && text.trim())
      out.push(symbolsSection(mode, symbolLookup.items, symbolLookup.busy));
    return out;
  }, [
    mode,
    shown.files,
    shown.text,
    shown.symbols,
    jump,
    fileHits,
    recent,
    activePath,
    textQuery,
    found.result,
    found.loading,
    symbolLookup,
    text,
  ]);
  const rows: Row[] = useMemo(
    () => sections.flatMap((s) => s.rows),
    [sections],
  );

  const indexing = fileList.isPending && shown.files;
  const working = indexing || found.loading || symbolLookup.busy;
  const somethingTyped = !!(jump.text || text.trim());
  const textStoppedEarly = found.result?.truncated && shown.text && textQuery;
  return {
    sections,
    rows,
    indexing,
    nothingFound: somethingTyped && !working && !rows.length,
    fileListError:
      shown.files && fileList.isError
        ? { error: fileList.error, retry: () => void fileList.refetch() }
        : undefined,
    note: found.error
      ? { text: errorMessage(found.error), problem: true }
      : {
          text: textStoppedEarly
            ? "Text results stopped early; narrow the query."
            : "↑↓ to pick · ↵ to open · tab to switch section",
          problem: false,
        },
  };
}
