import { memo } from "react";
import type { ChatMessage } from "../../shared/projects";
import { ProviderIcon } from "./ComposerModelPicker";
import { RichText } from "./ui";
import { agentMentionPattern, agentName } from "../../shared/agents";

/** What a side question's thread holds, for the bar under it. */
export interface SideThread {
  replies: number;
  last: number;
  answering: boolean;
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * A `/btw` question: outlined dashed, since the main session never heard it.
 * In the main thread a bar under it opens its side thread, like a Slack reply
 * count; atop its own thread it stands alone.
 */
export const SideQuestion = memo(function SideQuestion({
  message: m,
  thread,
  onOpen,
}: {
  message: ChatMessage;
  thread?: SideThread;
  onOpen: () => void;
}) {
  const agent = agentName(m.provider);
  return (
    <article
      className="project-message user side-question"
      data-message-id={m.id}
      aria-label="Your side question"
    >
      <header>
        <strong>{m.author ?? "You"}</strong>
        <time>{clock(m.created)}</time>
      </header>
      <div className="side-question-body">
        <RichText text={m.body.replace(agentMentionPattern, "")} />
        {thread && (
          <button type="button" className="side-thread-bar" onClick={onOpen}>
            <span className="side-thread-face" aria-hidden>
              <ProviderIcon provider={m.provider} />
            </span>
            {thread.answering && !thread.replies ? (
              <span className="side-thread-when">{agent} is answering…</span>
            ) : (
              <>
                <strong>
                  {thread.replies} {thread.replies === 1 ? "reply" : "replies"}
                </strong>
                <span className="side-thread-when">
                  {thread.answering
                    ? `${agent} is answering…`
                    : `Last reply ${clock(thread.last)}`}
                </span>
                <span className="side-thread-view">View thread ›</span>
              </>
            )}
          </button>
        )}
      </div>
    </article>
  );
});
