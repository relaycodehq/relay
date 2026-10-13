// One agent of a council in its hidden thread: a deep review's reviewer.
import { CircleCheck, RotateCcw } from "lucide-react";
import { clock } from "../../../../shared/waiting";
import { hasCouncilReport } from "../../../../shared/council";
import { duration } from "../../../../shared/activity-labels";
import { agentMentionPattern, agentName } from "../../../../shared/agents";
import type { ReviewAgent } from "../../../../shared/deep-review";
import type { ProjectFileLink } from "../../../../shared/project-file-links";
import { traitsName, useAgentName } from "../useAgentName";
import { useFollowEnd } from "./useFollowEnd";
import { useMemberThread } from "./useMemberThread";
import { RichText } from "../../../ui/RichText";
import { AgentTurn } from "../../agent-turn/AgentTurn";
import { AgentError } from "../../agents/AgentError";
import { formatTokens } from "../../agents/ContextWindowMeter";
import { ProviderIcon } from "../../agents/ComposerModelPicker";
import { useNow } from "../../../lib/useNow";

function RunningTime({ started }: { started: number }) {
  return <>{duration(useNow(1000) - started)}</>;
}

export function CouncilMember({
  number,
  agent,
  chatId,
  live,
  projectRoot,
  onOpenFile,
  onStop,
  onResume,
}: {
  number: number;
  agent: ReviewAgent;
  chatId: string;
  live: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  /** Stops this reviewer alone; the lead goes on with the others' reports. */
  onStop?: () => void;
  /** Runs a reviewer that stopped or didn't finish again, before the lead starts. */
  onResume?: () => void;
}) {
  const name = useAgentName();
  const messages = useMemberThread(chatId, live);
  const answer = [...messages].reverse().find((m) => m.role === "assistant");
  const tokens = answer?.context
    ? (answer.context.totalTokens ?? answer.context.usedTokens)
    : 0;
  const { scroll, column, onScroll } = useFollowEnd();
  return (
    <section
      className="deep-review-pane"
      aria-label={`Reviewer ${number}: ${name(agent)}`}
    >
      <header>
        <ProviderIcon provider={agent.provider} />
        <strong>{name(agent)}</strong>
        <span className="muted">{traitsName(agent)}</span>
        {answer &&
          (answer.status === "streaming" || answer.ended !== undefined) && (
            <span
              className="deep-review-pane-time"
              title={
                answer.status === "streaming"
                  ? "Elapsed review time"
                  : "Review duration"
              }
            >
              {answer.status === "streaming" ? (
                <RunningTime key={answer.id} started={answer.created} />
              ) : (
                duration((answer.ended ?? answer.created) - answer.created)
              )}
            </span>
          )}
        <span className="spacer" />
        {tokens > 0 && (
          <span
            className="deep-review-pane-tokens"
            title={`${tokens.toLocaleString()} tokens processed, cache reads included`}
          >
            {formatTokens(tokens)} tokens
          </span>
        )}
        {hasCouncilReport(answer) && (
          <span className="deep-review-pane-status done">
            <CircleCheck size={13} /> Done
          </span>
        )}
        {answer?.status === "complete" && !hasCouncilReport(answer) && (
          <span className="deep-review-pane-status">No report</span>
        )}
        {(answer?.status === "failed" || answer?.status === "cancelled") && (
          <span className="deep-review-pane-status">
            {answer.status === "cancelled" ? "Stopped" : "Didn't finish"}
            {onResume && (
              <button type="button" className="text-button" onClick={onResume}>
                <RotateCcw size={12} />
                {answer.status === "cancelled" ? "Resume" : "Retry"}
              </button>
            )}
          </span>
        )}
        {onStop && answer?.status === "streaming" && (
          <button
            type="button"
            className="icon-button deep-review-pane-stop"
            aria-label={`Stop ${name(agent)}`}
            title={`Stop ${name(agent)}; the lead goes on with the other reports`}
            onClick={onStop}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="2" y="2" width="8" height="8" rx="1.5" />
            </svg>
          </button>
        )}
      </header>
      <div className="deep-review-pane-thread" ref={scroll} onScroll={onScroll}>
        <div ref={column}>
          {messages.map((m) =>
            m.role === "user" ? (
              <article className="project-message user" key={m.id}>
                <header>
                  <strong>You</strong>
                  <span className="muted">via Deep review</span>
                </header>
                <div className="markdown deep-review-pane-prompt">
                  <p>{m.body.replace(agentMentionPattern, "")}</p>
                </div>
              </article>
            ) : (
              <article className="project-message assistant" key={m.id}>
                <header>
                  <strong>
                    <ProviderIcon provider={m.provider} />
                    {agentName(m.provider)}
                  </strong>
                  <time>{clock(m.created)}</time>
                </header>
                <AgentTurn
                  message={m}
                  projectRoot={projectRoot}
                  onOpenFile={onOpenFile}
                  onChanges={() => {}}
                />
                {m.body.trim() && (
                  <RichText
                    text={m.body}
                    projectRoot={projectRoot}
                    onOpenFile={onOpenFile}
                  />
                )}
                {m.status === "complete" && !hasCouncilReport(m) && (
                  <p className="muted" role="status">
                    This run ended without a written report.
                  </p>
                )}
                {m.status === "cancelled" && (
                  <p className="muted" role="status">
                    Stopped · partial output kept
                  </p>
                )}
                {m.error && m.status !== "cancelled" && (
                  <AgentError error={m.error} />
                )}
              </article>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
