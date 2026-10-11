import type { ReactNode } from "react";
import { Redo2, RotateCw, Undo2 } from "lucide-react";
import type { FileEditor } from "../useEditableDiff";
import type { LocalFileSession } from "../useLocalFile";
import { IconButton } from "../../../ui/ui";

export function EditHistory({
  size,
  editor,
}: {
  size: number;
  editor: () => FileEditor | undefined;
}) {
  return (
    <>
      <IconButton
        label="Undo code edit"
        className="editor-history"
        onClick={() => editor()?.undo()}
      >
        <Undo2 size={size} />
      </IconButton>
      <IconButton
        label="Redo code edit"
        className="editor-history"
        onClick={() => editor()?.redo()}
      >
        <Redo2 size={size} />
      </IconButton>
    </>
  );
}

/**
 * The editor's state line, which says so when the file changed on disk under
 * unsaved edits. It takes the state's place, so nothing below moves.
 */
export function DiskState({
  file,
  className,
  children,
}: {
  file: LocalFileSession;
  className?: string;
  children: ReactNode;
}) {
  const stale = file.changedOnDisk && !file.saving;
  return (
    <span
      className={`${className ?? ""} ${stale ? "stale" : ""}`.trim() || undefined}
      role="status"
    >
      {stale ? (
        <>
          Changed on disk ·
          <button
            type="button"
            className="text-button"
            onClick={file.requestReload}
          >
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
  file,
}: {
  size: number;
  file: LocalFileSession;
}) {
  return (
    <IconButton
      label="Reload local file"
      disabled={file.saving || file.loading}
      onClick={file.requestReload}
    >
      <RotateCw size={size} />
    </IconButton>
  );
}
