import { useEffect, useMemo, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { useStableCallback } from "../../lib/useStableCallback";
import { problemMarkers } from "../checks/editor-checks";
import { useBufferChecks } from "../checks/useBufferChecks";
import type { ChecksController } from "../checks/useProjectChecks";
import { useSymbolNavigation } from "../diff/SymbolNavigation";
import { codeVision } from "./code-vision/code-vision";
import type { FileDocument } from "./documents";
import type { EditorTarget, FileEditorProps, OpenTarget } from "./editor-types";
import { usageCount } from "./lsp-requests";
import { servedBy, syncWithServer } from "./lsp-sync";
import { useEditorDiagnostics } from "./useEditorDiagnostics";
import { useHostExtensions } from "./useHostExtensions";
import { useLspActions } from "./useLspActions";
import { useSymbolActions } from "./useSymbolActions";

/**
 * Everything that answers questions about the code: the project's checks and
 * their squiggles, the language server, and what the editor's keys do with the
 * symbol at the caret. `slots` are the extensions to give the editor.
 */
export function useCodeIntelligence({
  doc,
  target,
  checks,
  text,
  hash,
  view,
  hostProps,
}: {
  doc: FileDocument;
  target: EditorTarget;
  checks: ChecksController;
  /** The text once typing has settled. */
  text: string | undefined;
  hash: string | undefined;
  view: EditorView | undefined;
  /** What the host gave the editor to open files, step back and forward, search and ask. */
  hostProps: Pick<FileEditorProps, "onOpenFile" | "onBack" | "onForward" | "host" | "onAsk">;
}) {
  const { path, source } = doc;
  const where = source.kind === "project" ? source.where : undefined;
  const [error, setError] = useState<unknown>();
  const symbols = useSymbolNavigation(target, path, hash, checks.state, "editing");
  const { problems } = useBufferChecks(checks, path, text, hash, setError);
  const markers = useMemo(() => problemMarkers(problems), [problems]);
  const served = servedBy(doc);
  useEffect(() => {
    syncWithServer(doc);
  }, [doc]);
  const openFile = useStableCallback((to: OpenTarget) =>
    hostProps.onOpenFile?.(to),
  );
  const lspActions = useLspActions({
    doc,
    where: where ?? "",
    enabled: served,
    onOpen: openFile,
    onError: setError,
  });
  useEditorDiagnostics(view, markers, lspActions.diagnostics);
  const actions = useSymbolActions({
    path,
    served,
    hash,
    target,
    symbols,
    lspActions,
    onOpenFile: hostProps.onOpenFile,
    onBack: hostProps.onBack,
    onForward: hostProps.onForward,
    host: hostProps.host,
    onError: setError,
  });
  const hostExtensions = useHostExtensions({
    doc,
    where,
    served,
    onOpen: openFile,
    onAsk: hostProps.onAsk,
  });
  const showUsages = useStableCallback(
    (on: EditorView, pos: number) => void lspActions.references(on, pos),
  );
  const vision = useMemo(
    () =>
      served && where !== undefined
        ? codeVision({ countUsages: (on, pos) => usageCount(where, path, on, pos), showUsages })
        : [],
    [served, where, path, showUsages],
  );
  const host = useMemo(() => [hostExtensions, vision], [hostExtensions, vision]);
  return {
    symbols,
    problems,
    lspActions,
    served,
    error,
    slots: { actions, host },
  };
}
