import type { ChatSummary } from "../../../shared/projects";
import { Modal } from "../../ui/ui";

/**
 * Archiving a thread whose worktree has work the checkout doesn't: delete
 * the folder too, or keep it. Its branch stays either way.
 */
export function ArchiveWorktreeDialog({
  chat,
  files,
  onArchive,
  onCancel,
}: {
  chat: ChatSummary;
  files: number;
  onArchive: (dropWorktree: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <Modal title="Delete its worktree too?" onClose={onCancel}>
      <p>
        {files} {files === 1 ? "file has" : "files have"} changes that aren’t
        in {chat.worktree?.from ?? "the project folder’s branch"}. Deleting
        the folder keeps its branch, and Relay keeps a snapshot of what isn’t
        committed.
      </p>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={() => onArchive(false)}>
          Keep worktree
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => onArchive(true)}
        >
          Delete worktree
        </button>
      </div>
    </Modal>
  );
}
