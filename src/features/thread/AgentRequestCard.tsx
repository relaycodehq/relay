import { useState } from "react";
import { AgentQuestionForm } from "./AgentQuestionForm";
import { LockKeyhole, MessageCircleQuestion, Ellipsis } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import type {
  AgentRequest,
  AgentResponse,
  AgentDecision,
} from "../../../shared/agent-modes";
import "./agent-request.css";
const labels: Record<AgentDecision, string> = {
  accept: "Approve",
  acceptForSession: "Always",
  decline: "Decline",
  cancel: "Cancel",
};
export function AgentRequestCard({
  request,
  onRespond,
  pendingCount = 1,
  deferred = false,
}: {
  request: AgentRequest;
  pendingCount?: number;
  /** The agent keeps working; answering requires an explicit Send. */
  deferred?: boolean;
  onRespond: (response: AgentResponse) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const canRemember = request.decisions?.includes("acceptForSession");
  async function respond(response: AgentResponse) {
    setBusy(true);
    setError(undefined);
    try {
      await onRespond(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <section className="agent-request" aria-label={request.title}>
      <header>
        {request.kind === "approval" ? (
          <LockKeyhole size={15} />
        ) : (
          <MessageCircleQuestion size={15} />
        )}
        <strong>{request.title}</strong>
        {pendingCount > 1 && <small>1/{pendingCount}</small>}
      </header>
      {deferred && (
        <p className="agent-question-timing">Answer whenever you're ready.</p>
      )}
      {request.detail && <pre>{request.detail}</pre>}
      {request.kind === "question" && (
        <AgentQuestionForm
          questions={request.questions ?? []}
          busy={busy}
          onRespond={respond}
          deferred={deferred}
        />
      )}

      {request.kind === "approval" && (
        <footer>
          {(["decline", "acceptForSession", "accept"] as const)
            .filter((d) => request.decisions?.includes(d))
            .map((decision) => (
              <button
                type="button"
                key={decision}
                className={decision === "accept" ? "primary" : ""}
                disabled={busy}
                title={
                  decision === "acceptForSession"
                    ? "Don't ask again in this thread"
                    : undefined
                }
                onClick={() => void respond({ kind: "approval", decision })}
              >
                {decision === "accept" && canRemember
                  ? "Once"
                  : labels[decision]}
              </button>
            ))}
          {request.decisions?.includes("cancel") && (
            <Menu.Root>
              <Menu.Trigger disabled={busy} aria-label="More approval options">
                <Ellipsis size={16} />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner
                  className="composer-popup-positioner"
                  side="top"
                  align="end"
                  sideOffset={6}
                >
                  <Menu.Popup className="composer-select-popup">
                    <Menu.Item
                      className="composer-select-item"
                      disabled={busy}
                      onClick={() =>
                        void respond({ kind: "approval", decision: "cancel" })
                      }
                    >
                      {labels.cancel}
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}
        </footer>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
