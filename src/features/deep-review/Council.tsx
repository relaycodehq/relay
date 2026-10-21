import { Telescope } from "lucide-react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { DeepReviewState } from "../../../shared/deep-review";
import { hasCouncilReport, memberAnswer } from "../../../shared/council";
import { chatKey, fetchChat } from "../../lib/chat-events";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { useAgentName } from "./useAgentName";
import { useCouncilFold } from "./council/useCouncilFold";
import {
  CouncilHalted,
  CouncilRunning,
  CouncilToggle,
} from "./council/Council";
import { CouncilMember } from "./council/CouncilMember";
import { useStartedThreads } from "../agent-turn/StartedThreads";

/**
 * The reviewers side by side, folded away once the lead has reported. Each
 * opens its own thread, listed under this one, to be steered and continued.
 */
export function DeepReviewCouncil({
  state,
  kept,
  hasLead,
  leadHalted,
  busy,
  projectRoot,
  onOpenFile,
  onResume,
  onStop,
  onStopMember,
  onResumeMember,
  onLead,
}: {
  state: DeepReviewState;
  /** Findings in the lead's report, once there is one. */
  kept?: number;
  /** The lead has answered at least once. */
  hasLead: boolean;
  /** The lead's first answer stopped and is still the latest; see leadStoppedLast. */
  leadHalted?: boolean;
  busy: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  /** Left out on a round a later one took over from. */
  onResume?: () => void;
  /** Stops the reviewers at work, as the composer's Stop does. */
  onStop?: () => void;
  onStopMember?: (slot: number) => void;
  onResumeMember?: (slot: number) => void;
  /** Hands over to the lead with the reports that are in. */
  onLead?: () => void;
}) {
  const name = useAgentName();
  const started = useStartedThreads();
  const reportsIn = useReportsIn(state);
  const { open, toggle } = useCouncilFold(state.status === "done");
  const count = state.reviewers.length;
  // A big council shows each agent once in its header, and smaller panes.
  const many = count > 4;
  const glyphs = many
    ? state.reviewers.filter(
        (r, i, all) => all.findIndex((o) => o.provider === r.provider) === i,
      )
    : state.reviewers;
  return (
    <section className="deep-review-council" aria-label="Reviewers">
      <CouncilToggle open={open} onToggle={toggle} members={glyphs}>
        <Telescope size={14} />
        <strong>Council</strong>
        <span>
          {count} {count === 1 ? "reviewer" : "reviewers"}
          {state.status === "reviewing"
            ? " at work"
            : kept !== undefined
              ? ` · ${kept} ${kept === 1 ? "finding" : "findings"} kept`
              : ""}
        </span>
      </CouncilToggle>
      {open && (
        <div
          className="deep-review-grid"
          data-count={count}
          data-many={many || undefined}
        >
          {state.reviewers.map((r, i) => {
            const thread = started?.threads.find((c) => c.id === r.chatId);
            return (
              <CouncilMember
                key={r.chatId}
                number={i + 1}
                agent={r}
                chatId={r.chatId}
                live={state.status === "reviewing"}
                projectRoot={projectRoot}
                onOpenFile={onOpenFile}
                onStop={
                  onStopMember && state.status === "reviewing"
                    ? () => onStopMember(i)
                    : undefined
                }
                onResume={
                  onResumeMember && !hasLead && state.status !== "leading"
                    ? () => onResumeMember(i)
                    : undefined
                }
                onOpen={
                  thread && started ? () => started.open(thread) : undefined
                }
              />
            );
          })}
        </div>
      )}
      {onStop && state.status === "reviewing" && (
        <CouncilRunning busy={busy} onStop={onStop} />
      )}
      {(state.status === "stopped" || state.status === "failed") &&
        (hasLead ? (
          leadHalted && (
            <CouncilHalted
              text="The lead stopped before its report."
              action="Resume lead"
              busy={busy}
              onResume={onResume}
            />
          )
        ) : (
          <CouncilHalted
            text={
              state.status === "failed"
                ? "No reviewer finished, so the lead has nothing to check."
                : reportsIn !== undefined
                  ? `Review stopped · ${reportsIn} of ${count} reports in.`
                  : "Review stopped."
            }
            action={state.status === "stopped" ? "Resume review" : "Try again"}
            busy={busy}
            onResume={onResume}
            other={
              onLead && reportsIn && state.status === "stopped"
                ? {
                    label: `Lead with ${reportsIn === 1 ? "1 report" : `${reportsIn} reports`}`,
                    onClick: onLead,
                  }
                : undefined
            }
          />
        ))}
      {state.status === "leading" && !hasLead && (
        <p className="muted deep-review-handover">
          Handing over to {name(state.lead)}…
        </p>
      )}
    </section>
  );
}

/** How many reviewers' reports a stopped review holds, from their threads. */
function useReportsIn(state: DeepReviewState) {
  const qc = useQueryClient();
  const stopped = state.status === "stopped";
  return useQueries({
    queries: state.reviewers.map((r) => ({
      queryKey: chatKey(r.chatId),
      queryFn: () => fetchChat(qc, r.chatId),
      enabled: stopped,
    })),
    combine: (members) =>
      stopped && members.every((m) => m.data)
        ? members.filter((m) =>
            hasCouncilReport(memberAnswer(m.data!.messages)),
          ).length
        : undefined,
  });
}
