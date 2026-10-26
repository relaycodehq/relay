import { useEffect } from "react";
import { setDiagnostics } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { LspDiagnostic } from "../../../shared/language-servers";
import type { ProblemMarker } from "../checks/editor-checks";
import { lspDiagnostics } from "./lsp";
import { problemDiagnostics } from "./problems";

/** Squiggles for the checks' problems and the language server's, once each where both report the same one. */
export function useEditorDiagnostics(
  view: EditorView | undefined,
  markers: readonly ProblemMarker[],
  serverDiagnostics: readonly LspDiagnostic[],
) {
  useEffect(() => {
    if (!view) return;
    const seen = new Set<string>();
    const all = [
      ...problemDiagnostics(view.state.doc, markers),
      ...lspDiagnostics(view.state.doc, serverDiagnostics),
    ].filter((d) => {
      const key = `${d.from}:${d.to}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    view.dispatch(setDiagnostics(view.state, all));
  }, [view, markers, serverDiagnostics]);
}
