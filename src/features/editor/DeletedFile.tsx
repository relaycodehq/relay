import type { ReactNode } from "react";
import type { CodeReference } from "../../../shared/code-references";
import { EditorPath } from "../../ui/EditorPath";
import { SnapshotView } from "./SnapshotView";
import { useAskSelection } from "./useAskSelection";

/**
 * A file deleted here, as it was last committed: read-only, with the way
 * back. There is nothing to edit until it's restored.
 */
export function DeletedFile({
  lead,
  path,
  text,
  label = "HEAD",
  restoring,
  onRestore,
  onAsk,
}: {
  /** Before the path, like the file list's toggle. */
  lead?: ReactNode;
  path: string;
  /** The version before it was deleted. */
  text: string;
  /** Which version that is. */
  label?: string;
  restoring?: boolean;
  onRestore?: () => void;
  onAsk?: (ref: CodeReference) => void;
}) {
  const ask = useAskSelection(path, label, onAsk);
  return (
    <section className="project-inline-editor deleted-file" aria-label="Deleted file">
      <div className="editor-bar">
        {lead}
        <EditorPath path={path}>
          <span className="editor-bar-state">Deleted · {label}’s version</span>
        </EditorPath>
        {onRestore && (
          <button className="primary" disabled={restoring} onClick={onRestore}>
            Restore
          </button>
        )}
      </div>
      <SnapshotView path={path} text={text} label={`${path}, deleted`} extensions={ask} />
    </section>
  );
}
