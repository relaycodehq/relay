import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorktreeMove } from "../../../shared/projects";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import { ErrorBox, Modal, Spinner } from "../../ui/ui";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { noteUsed } from "../../lib/used";
import "./changed-files.css";
import "./worktrees.css";

/**
 * Confirms moving a project-folder thread into a worktree of its own. Every
 * uncommitted edit goes along, including other threads' edits in the same files.
 */
export function MoveToWorktreeDialog({
  chatId,
  onClose,
}: {
  chatId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["worktree-move", chatId],
    queryFn: () => api.projectWorktreeMove(chatId),
    staleTime: 0,
    gcTime: 0,
  });
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<unknown>();
  const move = async () => {
    setMoving(true);
    setError(undefined);
    try {
      await api.moveProjectChatToWorktree(chatId);
      noteUsed("move-worktree");
      onClose();
    } catch (e) {
      setError(e);
      void preview.refetch();
    } finally {
      setMoving(false);
      void qc.invalidateQueries({ queryKey: ["project-chats"] });
      void qc.invalidateQueries({ queryKey: ["project-chat", chatId] });
      void qc.invalidateQueries({ queryKey: ["worktree", chatId] });
      void qc.invalidateQueries({ queryKey: workingTreeKey() });
    }
  };
  const data = preview.data;
  return (
    <Modal
      title="Move into its own worktree?"
      onClose={onClose}
      className="worktree-move-dialog"
    >
      {preview.error ? (
        <ErrorBox error={preview.error} retry={() => void preview.refetch()} />
      ) : !data ? (
        <Spinner />
      ) : data.blocked ? (
        <p>{data.blocked}</p>
      ) : (
        <MovePreview files={data.files} />
      )}
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          {data?.blocked ? "Close" : "Cancel"}
        </button>
        {!data?.blocked && (
          <button
            type="button"
            className="primary"
            disabled={!data || moving}
            onClick={() => void move()}
          >
            {moving ? "Moving…" : "Move to worktree"}
          </button>
        )}
      </div>
    </Modal>
  );
}

function MovePreview({ files }: { files: WorktreeMove["files"] }) {
  const shared = files.filter((f) => f.threads?.length).length;
  return (
    <>
      <p>
        {files.length
          ? "Every uncommitted edit in the project folder moves with the thread, onto a new branch. The project folder goes back to its last commit; ignored files such as .env stay there."
          : "The project folder has no uncommitted edits, so the thread just carries on in a fresh worktree on a new branch."}{" "}
        The agent continues the same conversation there.
      </p>
      {shared > 0 && (
        <p className="worktree-move-shared">
          {shared === 1 ? "1 file was" : `${shared} files were`} also changed by
          another thread; those edits move too.
        </p>
      )}
      {files.length > 0 && (
        <ul className="worktree-move-files">
          {files.map((f) => {
            const slash = f.path.lastIndexOf("/");
            return (
              <li key={f.path} title={f.path}>
                <FileEntryIcon path={f.path} directory={false} />
                <span className="worktree-move-name">
                  {f.path.slice(slash + 1)}
                  {slash > 0 && <small>{f.path.slice(0, slash)}</small>}
                  {f.threads && (
                    <small className="worktree-move-also">
                      also {f.threads.map((t) => `“${t}”`).join(", ")}
                    </small>
                  )}
                </span>
                {!f.binary && (
                  <span className="diff-stat">
                    <span className="diff-stat-add">+{f.additions}</span>
                    <span className="diff-stat-del">−{f.deletions}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
