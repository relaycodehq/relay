import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import type {
  AgentDecision,
  AgentRequest,
  AgentResponse,
} from "../../../shared/agent-modes";
import { errorMessage } from "../../../shared/error-message";
import "./approval-tab.css";

const order = ["decline", "acceptForSession", "accept"] as const;

const labels: Record<(typeof order)[number], string> = {
  decline: "Decline",
  acceptForSession: "Always",
  accept: "Allow",
};

/** The detail's first line that says something: in a JSON detail, not the "{". */
export function detailSummary(detail: string | undefined) {
  const line = detail
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => /[\p{L}\p{N}]/u.test(line));
  return line?.replace(/,$/, "");
}

/** A permission the agent waits on, as one line on the composer's top edge.
 * The line opens to the whole detail. */
export function ApprovalTab({
  request,
  pendingCount,
  onRespond,
}: {
  request: AgentRequest;
  pendingCount: number;
  onRespond: (response: AgentResponse) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string>();
  const summary = detailSummary(request.detail);
  const hasMore = !!request.note || request.detail?.trim() !== summary;
  const ask = (
    <>
      <strong>{request.title}</strong>
      {summary && !open && <code>{summary}</code>}
    </>
  );

  async function respond(decision: AgentDecision) {
    setBusy(true);
    setError(undefined);
    try {
      await onRespond({ kind: "approval", decision });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <section className="approval-tab" aria-label={request.title}>
      <div className="approval-tab-face">
        <div className="approval-tab-line">
          <LockKeyhole size={12} />
          {hasMore ? (
            <button
              type="button"
              className="approval-tab-ask"
              aria-expanded={open}
              title={open ? "Hide details" : "Show details"}
              onClick={() => setOpen(!open)}
            >
              {ask}
            </button>
          ) : (
            <span className="approval-tab-ask">{ask}</span>
          )}
          {pendingCount > 1 && <small>1/{pendingCount}</small>}
          <ApprovalActions
            decisions={request.decisions}
            busy={busy}
            onPick={(decision) => void respond(decision)}
          />
        </div>
        {open && (
          <div className="approval-tab-detail">
            {request.note && <p>{request.note}</p>}
            {request.detail && <pre>{request.detail}</pre>}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}

/** Decline, then Always when it's offered, then Allow. */
function ApprovalActions({
  decisions,
  busy,
  onPick,
}: {
  decisions: AgentDecision[] | undefined;
  busy: boolean;
  onPick: (decision: AgentDecision) => void;
}) {
  return (
    <span className="approval-tab-actions">
      {order
        .filter((decision) => decisions?.includes(decision))
        .map((decision) => (
          <button
            type="button"
            key={decision}
            className={decision === "accept" ? "primary" : undefined}
            disabled={busy}
            title={
              decision === "acceptForSession"
                ? "Don't ask again in this thread"
                : undefined
            }
            onClick={() => onPick(decision)}
          >
            {labels[decision]}
          </button>
        ))}
    </span>
  );
}
