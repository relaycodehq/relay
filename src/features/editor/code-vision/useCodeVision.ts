import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EditorView } from "@codemirror/view";
import type { FileAuthors } from "../../../../shared/file-authors";
import { api } from "../../../lib/api";
import { lsp, onLspDiagnostics } from "../../language-servers/client";
import { committedLineAt, workedHunks } from "../change-gutter";
import type { FileDocument } from "../documents";
import { tellServerText } from "../lsp-sync";
import { setHints, type VisionHint } from "./code-vision";
import { codeAuthor, visionDeclarations, type Declaration } from "./vision-lines";

/**
 * Fills the hints over the file's declarations each time typing settles: the
 * server's outline says where they are, one blame of the file at HEAD who
 * wrote them. Their usages are counted by the editor, as they come into view.
 * A server still loading the project gives an empty outline, so that one is
 * asked again when the file's diagnostics come: by then it has read it.
 */
export function useCodeVision({
  doc,
  view,
  served,
  text,
  head,
  committed,
  barsAreHead,
}: {
  doc: FileDocument;
  view: EditorView | undefined;
  /** A language server covers the file. */
  served: boolean;
  /** The text once typing has settled. */
  text: string | undefined;
  /** The commit the file's history is read at; absent without Git. */
  head: string | undefined;
  committed: string | undefined;
  /** The change bars compare with HEAD, so their hunks map lines to it. */
  barsAreHead: boolean;
}) {
  const { path, source } = doc;
  const where = source.kind === "project" ? source.where : undefined;
  const authors = useQuery({
    queryKey: ["file-authors", where, head, path],
    queryFn: () => api.localFileAuthors(where!, { revision: head!, path }),
    enabled: !!where && !!head,
    staleTime: Infinity,
    retry: false,
  }).data;
  const [serverReads, setServerReads] = useState(0);
  const outlineWasEmpty = useRef(false);
  useEffect(() => {
    if (!served || !where) return;
    return onLspDiagnostics(where, path, () => {
      if (outlineWasEmpty.current) setServerReads((reads) => reads + 1);
    });
  }, [served, where, path]);

  useEffect(() => {
    if (!view || !served || !where || text === undefined) return;
    let current = true;
    void (async () => {
      await tellServerText(where, path, view.state.doc);
      const symbols = await lsp.documentSymbols(where, path).catch(() => []);
      if (!current) return;
      outlineWasEmpty.current = !symbols.length;
      const edited = text !== committed;
      // An edited file's committed lines come from the change bars, which compare with HEAD or not at all.
      const authorsFit = !edited || barsAreHead;
      // Their worker catches up a moment after an edit; until then no author rather than a wrong "new *".
      const needsLines = edited && authorsFit && !!authors;
      const linesKnown = !needsLines || (await hunksWorked(view, () => current));
      if (!current) return;
      const lineAt = (line: number) => (edited ? committedLineAt(view, line) ?? undefined : line);
      const usable = authorsFit && linesKnown ? authors : undefined;
      const hints = visionDeclarations(symbols).flatMap((declared) =>
        hintFor(view, declared, usable, lineAt),
      );
      view.dispatch({ effects: setHints.of(hints) });
    })();
    return () => {
      current = false;
    };
  }, [view, served, where, path, text, committed, authors, barsAreHead, serverReads]);
}

/** Waits up to 2s for the change bars' worker to catch up with the text; whether it has. */
async function hunksWorked(view: EditorView, current: () => boolean) {
  for (let tries = 0; !workedHunks(view.state) && tries < 40 && current(); tries++)
    await new Promise((settle) => setTimeout(settle, 50));
  return !!workedHunks(view.state);
}

function hintFor(
  view: EditorView,
  declared: Declaration,
  authors: FileAuthors | undefined,
  lineAt: (line: number) => number | undefined,
): VisionHint[] {
  const { doc } = view.state;
  if (declared.line >= doc.lines) return [];
  const line = doc.line(declared.line + 1);
  const namePos = Math.min(line.from + declared.character, line.to);
  if (!authors) return [{ namePos }];
  const last = Math.min(declared.endLine + 1, doc.lines);
  const lines = Array.from({ length: last - line.number + 1 }, (_, i) => lineAt(line.number + i));
  return [{ namePos, author: codeAuthor(authors, lines) }];
}
