import { useState } from "react";
import { AgentQuestionForm } from "./AgentQuestionForm";
import { AskPage } from "../html-render/AskPage";
import {
  Ellipsis,
  LockKeyhole,
  MessageCircleQuestion,
  PanelTop,
} from "lucide-react";
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
  chatId,
  request,
  onRespond,
  pendingCount = 1,
  deferred = false,
  onDismiss,
}: {
  /** Where an asked page (ask_html) is kept; without it the page can't load. */
  chatId?: string;
  request: AgentRequest;
  pendingCount?: number;
  /** The agent keeps working; answering requires an explicit Send. */
  deferred?: boolean;
  onRespond: (response: AgentResponse) => Promise<void>;
  /** Only message-based async questions can be hidden without responding. */
  onDismiss?: () => Promise<void>;
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
  async function dismiss() {
    if (!onDismiss) return;
    setBusy(true);
    setError(undefined);
    try {
      await onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="agent-request" aria-label={request.title}>
      <header>
        {request.kind === "approval" ? (
          <LockKeyhole size={15} />
        ) : request.kind === "page" ? (
          <PanelTop size={15} />
        ) : (
          <MessageCircleQuestion size={15} />
        )}
        <strong>{request.title}</strong>
        {pendingCount > 1 && <small>1/{pendingCount}</small>}
        {deferred && onDismiss && (
          <button
            type="button"
            className="text-button agent-question-dismiss"
            disabled={busy}
            title="Hide this question. You can reopen it later."
            onClick={() => void dismiss()}
          >
            Dismiss
          </button>
        )}
      </header>
      {deferred && (
        <p className="agent-question-timing">Answer whenever you're ready.</p>
      )}
      {request.detail &&
        (request.kind === "page" ? (
          <p className="agent-request-note">{request.detail}</p>
        ) : (
          <pre>{request.detail}</pre>
        ))}
      {request.kind === "page" && request.page && chatId && (
        <AskPage
          chatId={chatId}
          page={request.page}
          busy={busy}
          onAnswer={(answer) => void respond({ kind: "page", answer })}
        />
      )}
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
