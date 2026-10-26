import { documents, type DocumentSource } from "../editor/documents";
import {
  FindInFiles,
  SearchEverywhere,
  type OpenTarget,
  type SearchSymbol,
} from "../project-search";
import { lsp } from "../language-servers/client";
import type { FindRequest, PaletteRequest } from "./useEditorSearch";

/** Symbols in the folder's own files; the language servers also know ones in outside libraries. */
async function symbolsIn(
  where: string,
  query: string,
): Promise<SearchSymbol[]> {
  const found = await lsp.workspaceSymbols(where, query);
  const isOutside = (path: string) =>
    path.startsWith("/") || /^[A-Za-z]:/.test(path);
  return found
    .filter((s) => !isOutside(s.path))
    .map((s) => ({
      name: s.name,
      kind: s.kind,
      container: s.container,
      path: s.path,
      line: s.line + 1,
      column: s.character,
    }));
}

/** Search Everywhere over the folder's files, text and symbols. */
export function SearchPalette({
  where,
  request,
  recent,
  activePath,
  onOpen,
  onClose,
}: {
  where: string;
  /** Undefined while the palette is closed. */
  request?: PaletteRequest;
  /** The focused split's files, the one used last first. */
  recent: string[];
  activePath?: string;
  onOpen: (target: OpenTarget) => void;
  onClose: () => void;
}) {
  return (
    <SearchEverywhere
      key={request?.key}
      where={where}
      open={!!request}
      initialMode={request?.mode}
      recent={recent}
      activePath={activePath}
      symbols={(query) => symbolsIn(where, query)}
      onOpen={(target) => {
        onClose();
        onOpen(target);
      }}
      onClose={onClose}
    />
  );
}

/** Find in Files, docked under the editor. */
export function FindDock({
  where,
  source,
  request,
  onOpen,
  onClose,
}: {
  where: string;
  source: DocumentSource;
  request: FindRequest;
  onOpen: (target: OpenTarget) => void;
  onClose: () => void;
}) {
  return (
    <div className="files-find">
      <FindInFiles
        where={where}
        initialQuery={request.query}
        replace={request.replace}
        focusKey={request.key}
        onOpen={onOpen}
        onClose={onClose}
        onReplaced={(result) => {
          for (const { path } of result.replaced)
            void documents.find(source, path)?.check();
        }}
      />
    </div>
  );
}
