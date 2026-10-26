import { useState } from "react";
import type { WorktreeStatus } from "../../../shared/projects";
import { errorMessage } from "../../../shared/error-message";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { ListViewToggle } from "./ListViewToggle";
import { TurnFileList } from "./TurnFileList";
import { useSavedChanges } from "./useSavedChanges";
import "./changed-files.css";
import "./working-tree.css";

/**
 * What the thread's worktree has that the branch it came from doesn't yet,
 * committed or not, beside the editor. A file picked opens there against
 * that branch.
 */
export function BranchChanges({
  chatId,
  where,
  status,
  shownPath,
  onPick,
}: {
  chatId: string;
  where: string;
  status: WorktreeStatus & { from: string };
  /** The file in front of the editor, marked in the list. */
  shownPath: string | null;
  onPick: (path: string) => void;
}) {
  const { grouped, setGrouped } = useSavedChanges(where);
  const [revealError, setRevealError] = useState<string>();
  const reveal = (path: string) =>
    void api
      .revealProjectTurnFile(chatId, null, path)
      .catch((e) => setRevealError(errorMessage(e)));
  return (
    <section
      className="local-changes list-only"
      aria-label={`Changes against ${status.from}`}
    >
      <div className="working-content">
        <aside className="working-sidebar">
          <div className="working-file-list">
            <section>
              {/* The view's tab already names the branch and counts the files. */}
              <header className="branch-changes-head">
                <strong>Not in {status.from} yet</strong>
                <ListViewToggle grouped={grouped} onGrouped={setGrouped} />
              </header>
              {status.files.length ? (
                <TurnFileList
                  files={status.files}
                  selected={shownPath ?? undefined}
                  grouped={grouped}
                  onPick={onPick}
                  onReveal={reveal}
                />
              ) : (
                <p className="working-empty">
                  Nothing here that {status.from} doesn’t have.
                </p>
              )}
              {revealError && <ErrorBox error={new Error(revealError)} />}
            </section>
          </div>
        </aside>
      </div>
    </section>
  );
}
