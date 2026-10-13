import { ScanSearch } from "lucide-react";
import { clock } from "../../../shared/waiting";
import type { ChatMessage } from "../../../shared/projects";
import type {
  DeepReviewState,
  LeadAgent,
  ReviewAgent,
} from "../../../shared/deep-review";
import { traitsName, useAgentName } from "./useAgentName";
import { ProviderIcon } from "../agents/ComposerModelPicker";

function AgentChip({
  agent,
  name,
  times = 1,
}: {
  agent: ReviewAgent | LeadAgent;
  name: string;
  /** Reviewers on the same model and effort show once, counted. */
  times?: number;
}) {
  return (
    <span className="deep-review-agent">
      <ProviderIcon provider={agent.provider} />
      {name}
      <span className="muted">
        {traitsName(agent)}
        {times > 1 && ` ×${times}`}
      </span>
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
  const lineup = new Map<string, { agent: ReviewAgent; times: number }>();
  for (const r of state.reviewers) {
    const key = `${r.provider}\n${name(r)}\n${traitsName(r)}`;
    const seen = lineup.get(key);
    if (seen) seen.times++;
    else lineup.set(key, { agent: r, times: 1 });
  }
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
            {[...lineup].map(([key, { agent, times }]) => (
              <AgentChip
                key={key}
                agent={agent}
                name={name(agent)}
                times={times}
              />
            ))}
            <span className="deep-review-arrow" aria-label="then">
              →
            </span>
            <AgentChip agent={state.lead} name={name(state.lead)} />
          </div>
          {state.focus && <p>{state.focus}</p>}
          {scope.checkout && (
            <p className="muted">
              Reviewed and fixed in {scope.checkout.path}.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
