import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { ErrorBox, Modal } from "../../ui/ui";

/**
 * Confirms taking a thread back without the computer that has it, for when
 * that one can't hand it back: it's gone, its worktree is, or it never will be.
 */
export function AbandonDialog({
  chatId,
  computer,
  onClose,
}: {
  chatId: string;
  computer: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>();
  const abandon = async () => {
    setWorking(true);
    setError(undefined);
    try {
      await api.abandonHandoff(chatId);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setWorking(false);
      void qc.invalidateQueries({ queryKey: ["project-chats"] });
      void qc.invalidateQueries({ queryKey: ["project-chat", chatId] });
      void qc.invalidateQueries({ queryKey: ["handoff-view", chatId] });
    }
  };
  return (
    <Modal title={`Take it back without ${computer}?`} onClose={onClose}>
      <p>
        The thread unlocks here exactly as it was when it left, along with
        anything brought back before.
      </p>
      <p>
        Whatever was done on {computer} since stays there, on its branch, and
        won't come back by itself.
      </p>
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={working}
          onClick={() => void abandon()}
        >
          {working ? "Taking it back…" : "Take it back"}
        </button>
      </div>
    </Modal>
  );
}
