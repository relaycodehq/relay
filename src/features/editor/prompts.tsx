import { FolderGit2 } from "lucide-react";
import type { DocumentStatus } from "./documents";
import { Loading } from "../../ui/ui";

/** Asks before closing or reloading drops unsaved edits. */
export function UnsavedPrompt({
  asking,
  saving,
  onKeep,
  onDiscard,
  onSave,
}: {
  asking: "close" | "reload";
  saving: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="editor-confirmation" role="alert">
      <strong>Keep your unsaved edits?</strong>
      <span>
        {asking === "reload"
          ? "Reloading replaces this buffer with the current disk version."
          : "Save to the local folder, or discard this editing session."}
      </span>
      <div>
        <button onClick={onKeep}>Keep editing</button>
        <button className="danger subtle" disabled={saving} onClick={onDiscard}>
          {asking === "close" ? "Discard edits" : "Reload and discard edits"}
        </button>
        {asking === "close" && (
          <button className="primary" disabled={saving} onClick={onSave}>
            Save and close
          </button>
        )}
      </div>
    </div>
  );
}

/** Before the file is read: checking, or linking the PR's checkout, or trying again. */
export function FolderPrompt({
  status,
  onLoad,
}: {
  status: DocumentStatus;
  onLoad: (link: boolean) => void;
}) {
  const { loading, needsFolder } = status;
  return (
    <div className="local-editor-empty">
      {loading ? (
        <Loading text="Checking the local checkout…" />
      ) : (
        <>
          {needsFolder && (
            <p>
              Link this repository to your local checkout to edit its files.
            </p>
          )}
          <button onClick={() => onLoad(true)}>
            <FolderGit2 size={15} />{" "}
            {needsFolder ? "Link local folder" : "Choose another folder"}
          </button>
          {!needsFolder && <button onClick={() => onLoad(false)}>Retry</button>}
        </>
      )}
    </div>
  );
}
