import { Save } from "lucide-react";
import type { FileEditor } from "../../lib/useEditableDiff";
import type { LocalFileSession } from "../../lib/useLocalFile";
import { EditHistory, ReloadButton } from "./controls";

/** The modal editor's state and controls under the code, and where saves go. */
export function EditorFooter({
  file,
  editor,
  saveKeys,
}: {
  file: LocalFileSession;
  editor: () => FileEditor | undefined;
  saveKeys: string;
}) {
  const { source, dirty, saving, saved, loading } = file;
  const large = (source?.contents.split("\n").length ?? 0) > 5000;
  return (
    <>
      <div className="local-editor-footer">
        <span role="status">
          {saving
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : saved
                ? "Saved to local folder"
                : "Editing local checkout"}
        </span>
        <span className="editor-shortcuts">
          {saveKeys && `${saveKeys} · `}Save
          {large ? " · Large file, plain text" : ""}
        </span>
        <EditHistory size={16} editor={editor} />
        <ReloadButton size={16} file={file} />
        <button onClick={file.requestClose} disabled={saving}>
          Done
        </button>
        <button
          className="primary"
          disabled={!dirty || saving || loading}
          onClick={() => void file.save()}
        >
          <Save size={14} /> Save locally
        </button>
      </div>
      <p className="local-editor-note">
        Changes stay in your checkout. Commit and push separately to update the
        PR.
      </p>
    </>
  );
}
