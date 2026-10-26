import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { useShortcutLabel } from "../../lib/shortcuts";
import { bringBackEditor } from "./editor-windows";
import "../thread-windows/thread-windows.css";
import "./editor-windows.css";

/**
 * Where the Files pane was while its editor is in a window of its own: a
 * quiet note with the way there and the way back. There's no second editor
 * here, so a file is never edited in two places.
 */
export function EditorElsewhere({
  project,
  where,
  detail,
  onError,
}: {
  project: Project;
  where: string;
  /** Which worktree or branch the editor shows, if it isn't the project's own. */
  detail?: string;
  onError: (error: unknown) => void;
}) {
  const keys = useShortcutLabel("editor-window");
  return (
    <div className="editor-elsewhere">
      <div className="editor-elsewhere-window" aria-hidden="true">
        <span className="thread-elsewhere-bar">
          <span className="thread-elsewhere-lights">
            <i />
            <i />
            <i />
          </span>
          <span className="thread-elsewhere-title">
            {project.name}
            {detail && (
              <>
                {" "}
                <span>/</span> <b>{detail}</b>
              </>
            )}
          </span>
        </span>
        <span className="editor-elsewhere-lines">
          <i />
          <i />
          <i />
        </span>
      </div>
      <h2>Editing in its own window</h2>
      <p>Its files and unsaved edits are there.</p>
      <p className="editor-elsewhere-actions">
        <button
          type="button"
          className="text-button"
          onClick={() =>
            void api.openEditorWindow(project.id, where).catch(onError)
          }
        >
          Show window
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => void bringBackEditor(where).catch(onError)}
        >
          Bring back
        </button>
        {keys && <kbd>{keys}</kbd>}
      </p>
    </div>
  );
}
