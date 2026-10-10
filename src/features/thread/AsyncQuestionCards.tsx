import { useState } from "react";
import { agentName, type AgentProvider } from "../../../shared/agents";
import {
  PAGE_QUESTION_ID,
  type AsyncAgentQuestions,
  type ChatMessage,
} from "../../../shared/projects";
import type { AgentRequest } from "../../../shared/agent-modes";
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
        group.answers && group.page ? (
          <details className="async-question-answered" key={group.id}>
            <summary>
              {group.answers[PAGE_QUESTION_ID]
                ? `Answered "${group.page.title}"`
                : `Skipped "${group.page.title}"`}
            </summary>
            {group.answers[PAGE_QUESTION_ID] && (
              <pre>{group.answers[PAGE_QUESTION_ID].join("\n")}</pre>
            )}
          </details>
        ) : group.answers ? (
          <details className="async-question-answered" key={group.id}>
            <summary>
              Answered {group.questions.length === 1 ? "question" : "questions"}
            </summary>
            {group.questions.map((q) => (
              <p key={q.id}>
                <strong>{q.question}</strong>
                <br />
                {q.isSecret
                  ? "Hidden answer"
                  : group.answers![q.id]?.join(", ")}
              </p>
            ))}
          </details>
        ) : (
          <AsyncQuestionCard
            key={group.id}
            group={group}
            messageId={message.id}
            provider={message.provider}
            chatId={chatId}
          />
        ),
      )}
    </div>
  );
}

/** The card a group shows as: a page the agent asked with, or its questions. */
function requestOf(
  group: AsyncAgentQuestions,
  provider: AgentProvider,
): AgentRequest {
  if (group.page) {
    const ask = group.questions[0]?.question;
    return {
      id: group.id,
      kind: "page",
      title: group.page.title,
      ...(ask && ask !== group.page.title ? { detail: ask } : {}),
      page: group.page,
    };
  }
  return {
    id: group.id,
    kind: "question",
    title: `${agentName(provider)} has ${group.questions.length === 1 ? "a question" : "questions"}`,
    questions: group.questions,
  };
}

function AsyncQuestionCard({
  group,
  messageId,
  provider,
  chatId,
}: {
  group: AsyncAgentQuestions;
  messageId: string;
  provider: AgentProvider;
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
          chatId={chatId}
          request={requestOf(group, provider)}
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
