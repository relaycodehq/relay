import { Telescope } from "lucide-react";
import type { DeepReviewState } from "../../../shared/deep-review";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { useAgentName } from "./useAgentName";
import { useCouncilFold } from "./council/useCouncilFold";
import {
  CouncilHalted,
  CouncilRunning,
  CouncilToggle,
} from "./council/Council";
import { CouncilMember } from "./council/CouncilMember";

/** The reviewers side by side, folded away once the lead has reported. */
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
  reportsIn,
  resumedBy,
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
  onResume: () => void;
  /** Stops the reviewers at work, as the composer's Stop does. */
  onStop?: () => void;
  /** Reviewers whose report is in. */
  reportsIn?: number;
  /** The thread that last resumed the review, when another thread did. */
  resumedBy?: string;
  onStopMember?: (slot: number) => void;
  onResumeMember?: (slot: number) => void;
  /** Hands over to the lead with the reports that are in. */
  onLead?: () => void;
}) {
  const name = useAgentName();
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
            ? ` at work${resumedBy ? ` · resumed from “${resumedBy}”` : ""}`
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
          {state.reviewers.map((r, i) => (
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
            />
          ))}
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
