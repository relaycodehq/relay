import { FolderGit2 } from "lucide-react";
import type { LocalFileSession } from "../../lib/useLocalFile";
import { Loading } from "../ui";

/** Asks before closing or reloading drops unsaved edits. */
export function UnsavedPrompt({
  file,
  asking,
}: {
  file: LocalFileSession;
  asking: "close" | "reload";
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
        <button onClick={file.keepEditing}>Keep editing</button>
        <button
          className="danger subtle"
          disabled={file.saving}
          onClick={file.discard}
        >
          {asking === "close" ? "Discard edits" : "Reload and discard edits"}
        </button>
        {asking === "close" && (
          <button
            className="primary"
            disabled={file.saving}
            onClick={() => void file.save(true)}
          >
            Save and close
          </button>
        )}
      </div>
    </div>
  );
}

/** Before the file is read: checking, or linking the PR's checkout, or trying again. */
export function FolderPrompt({ file }: { file: LocalFileSession }) {
  const { loading, needsFolder } = file;
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
          <button onClick={() => void file.load(true)}>
            <FolderGit2 size={15} />{" "}
            {needsFolder ? "Link local folder" : "Choose another folder"}
          </button>
          {!needsFolder && (
            <button onClick={() => void file.load()}>Retry</button>
          )}
        </>
      )}
    </div>
  );
}
