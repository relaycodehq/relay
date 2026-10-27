import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChatSummary } from "../../../shared/projects";
import { errorMessage } from "../../../shared/error-message";
import { api } from "../../lib/api";
import { Modal } from "../../ui/ui";

/** The thread whose deletion waits for a yes, and deleting it once it has one. */
export function useThreadDelete({
  openId,
  moveOn,
  setError,
  refresh,
}: {
  /** The thread open by the time the deletion lands. */
  openId: () => string | undefined;
  /** Opens another thread in place of `c`. */
  moveOn: (c: ChatSummary) => unknown;
  setError: (message: string | undefined) => void;
  refresh: (c: ChatSummary) => unknown;
}) {
  const [asking, setAsking] = useState<ChatSummary>();
  // The question stays up while its worktree is taken down, which can take
  // a while, so nothing is sent to the thread meanwhile.
  const [deleting, setDeleting] = useState(false);
  // Picks the next thread from the list as it is once the thread is gone.
  const latestMoveOn = useRef(moveOn);
  latestMoveOn.current = moveOn;
  const remove = async (c: ChatSummary) => {
    setDeleting(true);
    setError(undefined);
    try {
      const gone = await api.deleteProjectChat(c.id);
      // Only once it's gone: a refusal leaves you in the thread. One of its
      // reviewers may be what's open.
      const opened = openId();
      if (opened && gone.includes(opened)) latestMoveOn.current(c);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAsking(undefined);
      setDeleting(false);
      void refresh(c);
    }
  };
  return {
    asking,
    deleting,
    ask: setAsking,
    confirm() {
      if (asking && !deleting) void remove(asking);
    },
    cancel() {
      if (!deleting) setAsking(undefined);
    },
  };
}

/** Asks before a thread goes for good, saying what goes with it. */
export function DeleteThreadDialog({
  chat,
  deleting,
  onDelete,
  onCancel,
}: {
  chat: ChatSummary;
  deleting: boolean;
  onDelete: () => void;
  onCancel: () => void;
}) {
  // Relay deletes only a folder it made that no other thread works in.
  const worktreeGoes = useQuery({
    queryKey: ["worktree-goes-on-delete", chat.id],
    queryFn: () => api.worktreeGoesOnDelete(chat.id),
    enabled: !!chat.worktree?.path,
    staleTime: 0,
  }).data;
  return (
    <Modal title="Delete this thread?" onClose={onCancel}>
      <p>
        “{chat.title}” and all its messages go for good. This can’t be undone.
      </p>
      {worktreeGoes && (
        <p>
          Its worktree’s folder goes too, with anything in it that isn’t
          committed. Its branch stays.
        </p>
      )}
      <div className="modal-actions">
        <button type="button" disabled={deleting} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? "Deleting…" : "Delete thread"}
        </button>
      </div>
    </Modal>
  );
}
