import { useState } from "react";
import { Send } from "lucide-react";
import type { Progress, Pull } from "../../shared/types";
import { revisionOf } from "../../shared/types";
import { api } from "../lib/api";
import { ErrorBox, Modal } from "./ui";

/** Finishing a review: its summary, verdict and this revision's drafts, published to Gitea. */
export function ReviewSheet({
  pull,
  progress,
  onBody,
  onClose,
  onSubmitted,
}: {
  pull: Pull;
  progress: Progress;
  onBody: (s: string) => void;
  onClose: () => void;
  onSubmitted: (ids: string[]) => void;
}) {
  const [event, setEvent] = useState<
      "COMMENT" | "APPROVED" | "REQUEST_CHANGES"
    >("COMMENT"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const body = progress.reviewBody ?? "";
  const revision = revisionOf(pull),
    drafts = progress.drafts.filter(
      (d) => d.body.trim() && d.revision === revision,
    ),
    stale = progress.drafts.filter(
      (d) => d.revision !== revision && d.body.trim(),
    );
  return (
    <Modal
      title="Finish your review"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        {drafts.length} inline comment{drafts.length !== 1 ? "s" : ""} will be
        published to Gitea.
      </p>
      {stale.length > 0 && (
        <p className="warning-note">
          {stale.length} draft{stale.length !== 1 ? "s" : ""} from an older
          revision will stay saved locally. Re-anchor them before publishing.
        </p>
      )}
      <label>
        Review summary
        <textarea
          autoFocus
          rows={5}
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder="What should the author know?"
          maxLength={65536}
        />
      </label>
      <div className="review-options">
        {(
          [
            ["COMMENT", "Comment", "Share feedback without a decision."],
            ["APPROVED", "Approve", "These changes look good to go."],
            [
              "REQUEST_CHANGES",
              "Request changes",
              "There are things to address before merging.",
            ],
          ] as const
        ).map(([v, title, detail]) => (
          <label key={v} className={v === event ? "selected" : ""}>
            <input
              type="radio"
              name="review-event"
              value={v}
              checked={event === v}
              onChange={() => setEvent(v)}
            />
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
          </label>
        ))}
      </div>
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        <button onClick={onClose} disabled={busy}>
          Keep reviewing
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            (event === "COMMENT" && !body.trim() && !drafts.length) ||
            (event === "REQUEST_CHANGES" && !body.trim())
          }
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await api.submitReview(pull, pull.head.sha, event, body, drafts);
              onSubmitted(drafts.map((d) => d.id));
              onClose();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Publishing…" : "Submit review"}
          <Send size={14} />
        </button>
      </div>
    </Modal>
  );
}
