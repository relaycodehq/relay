import { Split } from "lucide-react";

/** The commit message and its buttons under the changes list. */
export function CommitForm({
  message,
  onMessage,
  busy,
  canCommit,
  canSplit,
  onCommit,
  onSplit,
}: {
  message: string;
  onMessage: (message: string) => void;
  busy: boolean;
  canCommit: boolean;
  canSplit: boolean;
  onCommit: () => void;
  /** Left out where splitting isn't offered, as in a PR checkout. */
  onSplit?: () => void;
}) {
  return (
    <form
      className="working-commit"
      onSubmit={(e) => {
        e.preventDefault();
        onCommit();
      }}
    >
      <textarea
        aria-label="Commit message"
        placeholder="Commit message"
        value={message}
        onChange={(e) => onMessage(e.target.value)}
        disabled={busy}
        maxLength={16000}
      />
      <button
        className="primary"
        aria-label="Commit staged changes"
        disabled={!canCommit}
      >
        {busy ? "Working…" : "Commit staged"}
      </button>
      {onSplit && (
        <button
          type="button"
          className="working-split"
          disabled={!canSplit}
          onClick={onSplit}
        >
          <Split size={12} />
          Split into commits…
        </button>
      )}
      <small>
        Commits contain staged changes only. Unsaved editor buffers aren’t
        included.
      </small>
    </form>
  );
}
