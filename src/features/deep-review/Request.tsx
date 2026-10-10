import { ScanSearch } from "lucide-react";
import { clock } from "../../../shared/waiting";
import type { ChatMessage } from "../../../shared/projects";
import type {
  DeepReviewState,
  LeadAgent,
  ReviewAgent,
} from "../../../shared/deep-review";
import { effortName, useAgentName } from "./useAgentName";
import { ProviderIcon } from "../agents/ComposerModelPicker";

function AgentChip({
  agent,
  name,
}: {
  agent: ReviewAgent | LeadAgent;
  name: string;
}) {
  return (
    <span className="deep-review-agent">
      <ProviderIcon provider={agent.provider} />
      {name}
      <span className="muted">{effortName(agent)}</span>
    </span>
  );
}

/** The request, shown as your message with what it covers and who works on it. */
export function DeepReviewRequest({
  message,
  state,
}: {
  message: ChatMessage;
  state: DeepReviewState;
}) {
  const name = useAgentName();
  const { scope } = state;
  return (
    <article
      className="project-message user"
      data-message-id={message.id}
      aria-label="Your message"
    >
      <header>
        <strong>{message.author ?? "You"}</strong>
        <time>{clock(message.created)}</time>
      </header>
      <div className="markdown">
        <div className="deep-review-request">
          <div className="deep-review-request-title">
            <ScanSearch size={15} />
            <strong>Deep review</strong>
            <span>{scope.label}</span>
            {scope.title && <span className="muted">{scope.title}</span>}
            {scope.stats && (scope.stats.additions || scope.stats.deletions) ? (
              <span className="diff-stat">
                <span className="diff-stat-add">+{scope.stats.additions}</span>
                <span className="diff-stat-del">−{scope.stats.deletions}</span>
              </span>
            ) : null}
          </div>
          <div className="deep-review-request-agents">
            {state.reviewers.map((r) => (
              <AgentChip key={r.chatId} agent={r} name={name(r)} />
            ))}
            <span className="deep-review-arrow" aria-label="then">
              →
            </span>
            <AgentChip agent={state.lead} name={name(state.lead)} />
          </div>
          {state.focus && <p>{state.focus}</p>}
          {scope.checkout && (
            // The thread's Changes pane shows its own checkout, not this folder.
            <p className="muted">
              Reviewed and fixed in {scope.checkout.path}, not this thread's
              checkout.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
