import type { EditorView } from "@codemirror/view";
import { DiskState, EditHistory, ReloadButton, saveState } from "./controls";
import type { DocumentStatus } from "./documents";

/** The modal editor's footer: its state, the editing controls, and Done and Save. */
export function EditorFooter({
  status,
  saveKeys,
  view,
  onReload,
  onDone,
  onSave,
}: {
  status: DocumentStatus;
  saveKeys: string;
  view: () => EditorView | undefined;
  onReload: () => void;
  onDone: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <div className="local-editor-footer">
        <DiskState status={status} onReload={onReload}>
          {saveState(status, "Saved to local folder") || "Editing local checkout"}
        </DiskState>
        <span className="editor-shortcuts">{saveKeys && `${saveKeys} · `}Save</span>
        <EditHistory size={16} view={view} />
        <ReloadButton size={16} status={status} onReload={onReload} />
        <button onClick={onDone} disabled={status.saving}>
          Done
        </button>
        <button
          className="primary"
          disabled={!status.dirty || status.saving || status.loading}
          onClick={onSave}
        >
          Save locally
        </button>
      </div>
      <p className="local-editor-note">
        Changes stay in your checkout. Commit and push separately to update the PR.
      </p>
    </>
  );
}
