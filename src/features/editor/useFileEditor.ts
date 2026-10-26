import { useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { useShortcutLabel } from "../../lib/shortcuts";
import { useContentHash } from "../checks/diagnostics";
import type { FileEditorProps } from "./editor-types";
import { useCodeVision } from "./code-vision/useCodeVision";
import { useCodeIntelligence } from "./useCodeIntelligence";
import { useDiskCheck } from "./useDiskCheck";
import { useDocument, useSettledText } from "./useDocument";
import { useEditorBlame } from "./useEditorBlame";
import { useEditorChanges } from "./useEditorChanges";
import { useEditorTheme } from "./useEditorTheme";
import { useSaveShortcut } from "./useSaveShortcut";
import { useUnsavedPrompt } from "./useUnsavedPrompt";

export type FileEditorState = ReturnType<typeof useFileEditor>;

/**
 * What the inline editor and the modal one both need: the document's state,
 * its changes, the code intelligence, blame, saving and the unsaved prompt.
 */
export function useFileEditor(props: FileEditorProps) {
  const { doc, target, checks, inline = false } = props;
  const { path, source } = doc;
  const { status, file, comparing: docWantsChanges, comparedWith: baseline } = useDocument(doc);
  const text = useSettledText(doc);
  const hash = useContentHash(text);
  const plain = source.kind === "project" && !!source.plain;
  const committed = plain ? undefined : file?.original;
  const changes = useEditorChanges({ doc, inline, plain, baseline, committed, docWantsChanges });
  const theme = useEditorTheme();

  const viewRef = useRef<EditorView | undefined>(undefined);
  const [view, setView] = useState<EditorView>();
  const getView = () => viewRef.current;
  const onView = (next: EditorView | undefined) => {
    viewRef.current = next;
    setView(next);
  };
  const intelligence = useCodeIntelligence({ doc, target, checks, text, hash, view, hostProps: props });
  useCodeVision({
    doc,
    view,
    served: intelligence.served,
    text,
    head: plain ? undefined : file?.head,
    committed,
    barsAreHead: !baseline,
  });

  const headLabel = source.kind === "project" ? "HEAD" : "PR head";
  const blame = useEditorBlame({
    target,
    path,
    file,
    base: headLabel,
    view: getView,
    text,
    committed,
    plain,
    barsAreHead: !baseline,
  });

  useDiskCheck(doc, props.stamp);
  const save = () => void doc.save();
  useSaveShortcut(save);
  const saveKeys = useShortcutLabel("save");
  const unsaved = useUnsavedPrompt({ doc, closeRequest: props.closeRequest, onClose: props.onClose });

  return {
    doc,
    status,
    file,
    text,
    hash,
    plain,
    changes,
    theme,
    getView,
    onView,
    intelligence,
    headLabel,
    /** What the changes show against instead of the last commit, as the document was opened. */
    baseline,
    blame,
    save,
    saveKeys,
    unsaved,
    error: intelligence.error || status.error,
  };
}
