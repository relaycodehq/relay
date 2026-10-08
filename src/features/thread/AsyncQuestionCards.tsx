import { useState } from "react";
import type {
  AsyncAgentQuestions,
  ChatMessage,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { AgentRequestCard } from "./AgentRequestCard";

/** Saved questions stay usable even after the turn's live trace folds away. */
export function AsyncQuestionCards({
  message,
  chatId,
}: {
  message: ChatMessage;
  chatId: string;
}) {
  if (!message.questions?.length || !chatId) return null;
  return (
    <div className="async-question-cards">
      {message.questions.map((group) =>
        group.answers ? (
          <details className="async-question-answered" key={group.id}>
            <summary>
              Answered {group.questions.length === 1 ? "question" : "questions"}
            </summary>
            {group.questions.map((q) => (
              <p key={q.id}>
                <strong>{q.question}</strong>
                <br />
                {group.answers![q.id]?.join(", ")}
              </p>
            ))}
          </details>
        ) : (
          <AsyncQuestionCard
            key={group.id}
            group={group}
            messageId={message.id}
            chatId={chatId}
          />
        ),
      )}
    </div>
  );
}

function AsyncQuestionCard({
  group,
  messageId,
  chatId,
}: {
  group: AsyncAgentQuestions;
  messageId: string;
  chatId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function reopen() {
    setBusy(true);
    setError(undefined);
    try {
      await api.setProjectChatQuestionDismissed(
        chatId,
        messageId,
        group.id,
        false,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {/* Keep a partly written answer when the user dismisses and reopens. */}
      <div hidden={!!group.dismissed}>
        <AgentRequestCard
          deferred
          request={{
            id: group.id,
            kind: "question",
            title: "Codex has a question",
            questions: group.questions,
          }}
          onRespond={(response) =>
            api.answerProjectChatQuestion(chatId, messageId, group.id, response)
          }
          onDismiss={() =>
            api.setProjectChatQuestionDismissed(
              chatId,
              messageId,
              group.id,
              true,
            )
          }
        />
      </div>
      {group.dismissed && (
        <div className="async-question-dismissed">
          <details className="async-question-answered">
            <summary>
              Dismissed{" "}
              {group.questions.length === 1 ? "question" : "questions"}
            </summary>
            {group.questions.map((q) => (
              <p key={q.id}>{q.question}</p>
            ))}
          </details>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void reopen()}
          >
            Reopen
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
