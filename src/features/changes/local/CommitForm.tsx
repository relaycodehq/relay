import { Split } from "lucide-react";

/** The commit message and its buttons under the changes list. */
export function CommitForm({
  message,
  onMessage,
  busy,
  blocked,
  canCommit,
  canSplit,
  onCommit,
  onSplit,
}: {
  message: string;
  onMessage: (message: string) => void;
  busy: boolean;
  /** Why no commit can start here for now, shown on the disabled buttons. */
  blocked?: string;
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
        if (canCommit && !blocked) onCommit();
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
        disabled={!canCommit || !!blocked}
        title={blocked}
      >
        {busy ? "Working…" : "Commit staged"}
      </button>
      {onSplit && (
        <button
          type="button"
          className="working-split"
          disabled={!canSplit || !!blocked}
          title={blocked}
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
