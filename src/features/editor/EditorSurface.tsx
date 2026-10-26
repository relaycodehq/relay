import type { HTMLAttributes } from "react";
import type { EditorView } from "@codemirror/view";
import { Loading } from "../../ui/ui";
import { CodeEditor, type SlotValues } from "./CodeEditor";
import type { FileDocument } from "./documents";

/** The editor itself once the file is read, "Opening…" before that. */
export function EditorSurface({
  doc,
  loading,
  slots,
  handlers,
  onView,
}: {
  doc: FileDocument;
  loading: boolean;
  slots: SlotValues;
  /** Pointer handlers for the line blame on the line numbers. */
  handlers: HTMLAttributes<HTMLDivElement>;
  onView: (view: EditorView | undefined) => void;
}) {
  return (
    <div className="local-editor-surface" {...handlers} aria-busy={loading}>
      {doc.state ? (
        <CodeEditor doc={doc} slots={slots} onView={onView} />
      ) : (
        loading && <Loading text="Opening…" />
      )}
    </div>
  );
}
