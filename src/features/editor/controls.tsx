import type { ReactNode } from "react";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { Redo2, RotateCw, Undo2 } from "lucide-react";
import type { DocumentStatus } from "./documents";
import { IconButton } from "../../ui/ui";

export function EditHistory({
  size,
  view,
}: {
  size: number;
  view: () => EditorView | undefined;
}) {
  const run = (command: typeof undo) => {
    const current = view();
    if (current) command(current);
  };
  return (
    <>
      <IconButton
        label="Undo code edit"
        className="editor-history"
        onClick={() => run(undo)}
      >
        <Undo2 size={size} />
      </IconButton>
      <IconButton
        label="Redo code edit"
        className="editor-history"
        onClick={() => run(redo)}
      >
        <Redo2 size={size} />
      </IconButton>
    </>
  );
}

/**
 * The editor's state line. When the file changed on disk under unsaved edits
 * it says so, in the place of the usual state so nothing below moves.
 */
export function DiskState({
  status,
  onReload,
  className,
  children,
}: {
  status: DocumentStatus;
  onReload: () => void;
  className?: string;
  children: ReactNode;
}) {
  const stale = status.changedOnDisk && !status.saving;
  return (
    <span
      className={`${className ?? ""} ${stale ? "stale" : ""}`.trim() || undefined}
      role="status"
    >
      {stale ? (
        <>
          Changed on disk ·
          <button type="button" className="text-button" onClick={onReload}>
            Reload
          </button>
        </>
      ) : (
        children
      )}
    </span>
  );
}

export function ReloadButton({
  size,
  status,
  onReload,
}: {
  size: number;
  status: DocumentStatus;
  onReload: () => void;
}) {
  return (
    <IconButton
      label="Reload local file"
      disabled={status.saving || status.loading}
      onClick={onReload}
    >
      <RotateCw size={size} />
    </IconButton>
  );
}

/** What the state line says about saving; empty when there is nothing to say. */
export function saveState(status: DocumentStatus, saved = "Saved") {
  if (status.saving) return "Saving…";
  if (status.dirty) return "Unsaved changes";
  return status.saved ? saved : "";
}
