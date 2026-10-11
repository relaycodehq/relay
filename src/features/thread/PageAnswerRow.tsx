import type { ReactNode } from "react";
import type { ChatMessage, PageAnswer } from "../../../shared/projects";
import { LineDivider } from "../../ui/LineDivider";

/**
 * The message that answers a page the agent asked with (ask_html), as a quiet
 * line: its body is written for the agent, and the answer itself stays folded
 * under the page in the answer above.
 */
export function PageAnswerRow({
  message: m,
  answer,
  unread,
}: {
  message: ChatMessage;
  answer: PageAnswer;
  unread?: ReactNode;
}) {
  return (
    <LineDivider data-message-id={m.id} role="status">
      {unread}
      <span>
        {answer.skipped ? "You skipped" : "You answered"} “{answer.title}”
        {answer.skipped && " and left it to the agent"}
      </span>
    </LineDivider>
  );
}
