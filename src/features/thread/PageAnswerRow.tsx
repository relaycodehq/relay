import type { ChatMessage, PageAnswer } from "../../../shared/projects";

/**
 * The message that answers a page the agent asked with (ask_html), as a quiet
 * line: its body is written for the agent, and the answer itself stays folded
 * under the page in the answer above.
 */
export function PageAnswerRow({
  message: m,
  answer,
}: {
  message: ChatMessage;
  answer: PageAnswer;
}) {
  return (
    <div className="context-compaction" data-message-id={m.id} role="status">
      <span>
        {answer.skipped ? "You skipped" : "You answered"} “{answer.title}”
        {answer.skipped && " and left it to the agent"}
      </span>
    </div>
  );
}
