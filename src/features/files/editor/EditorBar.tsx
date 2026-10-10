import type { ReactNode } from "react";
import { Columns2, X } from "lucide-react";
import type { FileEditor } from "../useEditableDiff";
import type { LocalFileSession } from "../useLocalFile";
import { EditorPath } from "../EditorPath";
import { IconButton } from "../../../ui/ui";
import { EditHistory, ReloadButton } from "./controls";

/** The inline editor's bar: its path and state, then its controls. */
export function EditorBar({
  lead,
  path,
  file,
  editor,
  symbols,
  modes,
  actions,
  base,
  compare,
  onCompare,
  saveKeys,
}: {
  /** Before the path, like the file list's toggle. */
  lead?: ReactNode;
  path: string;
  file: LocalFileSession;
  editor: () => FileEditor | undefined;
  symbols: ReactNode;
  /** How a Markdown file shows: code, preview or both. */
  modes?: ReactNode;
  actions: ReactNode;
  base: string;
  compare: boolean;
  /** Absent for a folder without Git. */
  onCompare?: () => void;
  saveKeys: string;
}) {
  const { source, dirty, saving, saved, loading } = file;
  return (
    <div className="editor-bar">
      {lead}
      <EditorPath path={path} title={source?.path ?? path}>
        <span
          className={`editor-bar-state ${dirty ? "dirty" : ""}`}
          role="status"
        >
          {saving
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : saved
                ? "Saved"
                : ""}
        </span>
      </EditorPath>
      {source && symbols}
      <span className="divider" />
      {modes}
      <EditHistory size={15} editor={editor} />
      <ReloadButton size={15} file={file} />
      {actions}
      {onCompare && (
        <IconButton
          label={`Compare with ${base}`}
          active={compare}
          onClick={onCompare}
        >
          <Columns2 size={15} />
        </IconButton>
      )}
      <button
        className="primary"
        aria-label="Save locally"
        title={`Save to the local folder${saveKeys && ` (${saveKeys})`}`}
        disabled={!dirty || saving || loading}
        onClick={() => void file.save()}
      >
        Save
      </button>
      <IconButton
        label="Close file"
        disabled={saving}
        onClick={file.requestClose}
      >
        <X size={15} />
      </IconButton>
    </div>
  );
}
