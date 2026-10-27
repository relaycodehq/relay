import { useState } from "react";
import { AgentQuestionForm } from "./AgentQuestionForm";
import { AskPage } from "../html-render/AskPage";
import { MessageCircleQuestion, PanelTop } from "lucide-react";
import type { AgentRequest, AgentResponse } from "../../../shared/agent-modes";
import "./agent-request.css";
import { errorMessage } from "../../../shared/error-message";

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
  async function respond(response: AgentResponse) {
    setBusy(true);
    setError(undefined);
    try {
      await onRespond(response);
    } catch (e) {
      setError(errorMessage(e));
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
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="agent-request" aria-label={request.title}>
      <header>
        {request.kind === "page" ? (
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
      {request.note && <p className="agent-request-note">{request.note}</p>}
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

      {error && <p role="alert">{error}</p>}
    </section>
  );
}
