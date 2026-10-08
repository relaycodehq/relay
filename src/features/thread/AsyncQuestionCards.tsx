import type { ChatMessage } from "../../../shared/projects";
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
          <AgentRequestCard
            key={group.id}
            deferred
            request={{
              id: group.id,
              kind: "question",
              title: "Codex has a question",
              questions: group.questions,
            }}
            onRespond={(response) =>
              api.answerProjectChatQuestion(
                chatId,
                message.id,
                group.id,
                response,
              )
            }
          />
        ),
      )}
    </div>
  );
}
