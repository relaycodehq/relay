import { Redo2, RotateCw, Undo2 } from "lucide-react";
import type { FileEditor } from "../../lib/useEditableDiff";
import type { LocalFileSession } from "../../lib/useLocalFile";
import { IconButton } from "../ui";

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
