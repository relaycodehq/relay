import { useMemo, useRef } from "react";
import { EditorView } from "@codemirror/view";
import type { CodeReference } from "../../../shared/code-references";
import { keys } from "../../lib/mod-key";
import { askSelection, selectedLines } from "./ask-selection";
import type { OpenTarget } from "./editor-types";
import type { FileDocument } from "./documents";
import { blameTargets } from "./blame-targets";
import { lspFeatures } from "./lsp";

/**
 * What the host adds to the editor for this file: the line numbers blame
 * reads, the file's name for screen readers, the language server's hover and
 * completions, and asking in chat about the selection.
 */
export function useHostExtensions({
  doc,
  where,
  served,
  onOpen,
  onAsk,
}: {
  doc: FileDocument;
  /** Of the project's folder, when the file is in one. */
  where: string | undefined;
  /** A language server covers the file. */
  served: boolean;
  /** Opens where a hover card's symbol is declared; stays the same function. */
  onOpen: (target: OpenTarget) => void;
  onAsk: ((ref: CodeReference) => void) | undefined;
}) {
  const latestAsk = useRef(onAsk);
  latestAsk.current = onAsk;
  const asks = !!onAsk;
  const { path } = doc;
  return useMemo(
    () => [
      blameTargets,
      EditorView.contentAttributes.of({ "aria-label": path }),
      served && where ? lspFeatures(where, path, onOpen) : [],
      asks
        ? askSelection((view) => {
            const lines = selectedLines(view.state);
            if (!lines) return;
            latestAsk.current?.({
              path,
              ...lines,
              label: doc.status.dirty ? "Unsaved edit" : "Working file",
            });
          }, keys("⌥⏎", "Alt+Enter"))
        : [],
    ],
    [path, served, where, asks, doc, onOpen],
  );
}
