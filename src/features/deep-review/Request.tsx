import { ScanSearch } from "lucide-react";
import { clock } from "../../../shared/waiting";
import type { ChatMessage } from "../../../shared/projects";
import type {
  DeepReviewState,
  LeadAgent,
  ReviewAgent,
  ReviewPassState,
} from "../../../shared/deep-review";
import { formatLines } from "../../../shared/review-passes";
import { traitsName, useAgentName } from "./useAgentName";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { KindStatBreakdown } from "../changes/DiffStatBreakdown";

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
  // A split review asks each reviewer once a pass; the lineup is one pass's.
  for (const r of state.reviewers.filter((r) => !r.pass)) {
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
            {scope.stats?.byKind ? (
              <KindStatBreakdown by={scope.stats.byKind} />
            ) : scope.stats &&
              (scope.stats.additions || scope.stats.deletions) ? (
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
          {state.passes && <RequestPasses passes={state.passes} />}
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

/** The passes a split review runs, one a line. */
function RequestPasses({ passes }: { passes: ReviewPassState[] }) {
  return (
    <ol className="deep-review-passes deep-review-request-passes">
      {passes.map((pass, i) => (
        <li key={i}>
          <span className="deep-review-slot">{i + 1}</span>
          <span
            className={`deep-review-pass-paths${pass.seams ? " muted" : ""}`}
            title={pass.paths.join(" ")}
          >
            {pass.seams ? "How they fit together" : pass.paths.join(" ")}
          </span>
          <span className="deep-review-note">{formatLines(pass.lines)}</span>
        </li>
      ))}
    </ol>
  );
}
