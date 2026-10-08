// One agent of a council in its hidden thread: a deep review's reviewer, or
// an Ultraplan thinker.
import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { clock } from "../../../../shared/waiting";
import { agentMentionPattern, agentName } from "../../../../shared/agents";
import type { ReviewAgent } from "../../../../shared/deep-review";
import type { ProjectFileLink } from "../../../../shared/project-file-links";
import { effortName, useAgentName } from "../useAgentName";
import { useFollowEnd } from "./useFollowEnd";
import { useMemberThread } from "./useMemberThread";
import { RichText } from "../../../ui/RichText";
import { AgentTurn } from "../../agent-turn/AgentTurn";
import { AgentError } from "../../agents/AgentError";
import { formatTokens } from "../../agents/ContextWindowMeter";
import { ProviderIcon } from "../../agents/ComposerModelPicker";

export function CouncilMember({
  number,
  agent,
  chatId,
  live,
  projectRoot,
  onOpenFile,
  role = "Reviewer",
  title,
  via = "Deep review",
  prompt,
}: {
  number: number;
  agent: ReviewAgent;
  chatId: string;
  live: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  role?: string;
  /** Leads the header, like a thinker's job. */
  title?: ReactNode;
  via?: string;
  /** Shown in place of a request too long to read in a pane. */
  prompt?: string;
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
      aria-label={`${role} ${number}: ${name(agent)}`}
    >
      <header>
        {title}
        <ProviderIcon provider={agent.provider} />
        <strong>{name(agent)}</strong>
        <span className="muted">{effortName(agent)}</span>
        <span className="spacer" />
        {tokens > 0 && (
          <span
            className="deep-review-pane-tokens"
            title={`${tokens.toLocaleString()} tokens processed, cache reads included`}
          >
            {formatTokens(tokens)} tokens
          </span>
        )}
        {answer?.status === "complete" && (
          <span className="deep-review-pane-status done">
            <CircleCheck size={13} /> Done
          </span>
        )}
        {(answer?.status === "failed" || answer?.status === "cancelled") && (
          <span className="deep-review-pane-status">
            {answer.status === "cancelled" ? "Stopped" : "Didn't finish"}
          </span>
        )}
      </header>
      <div className="deep-review-pane-thread" ref={scroll} onScroll={onScroll}>
        <div ref={column}>
          {messages.map((m) =>
            m.role === "user" ? (
              <article className="project-message user" key={m.id}>
                <header>
                  <strong>You</strong>
                  <span className="muted">via {via}</span>
                </header>
                <div className="markdown deep-review-pane-prompt">
                  <p>{prompt ?? m.body.replace(agentMentionPattern, "")}</p>
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
