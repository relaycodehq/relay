import { Telescope } from "lucide-react";
import type { DeepReviewState } from "../../../shared/deep-review";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { useAgentName } from "./useAgentName";
import { useCouncilFold } from "./council/useCouncilFold";
import { CouncilHalted, CouncilToggle } from "./council/Council";
import { CouncilMember } from "./council/CouncilMember";

/** The reviewers side by side, folded away once the lead has reported. */
export function DeepReviewCouncil({
  state,
  hasLead,
  busy,
  projectRoot,
  onOpenFile,
  onResume,
}: {
  state: DeepReviewState;
  /** The lead has answered at least once. */
  hasLead: boolean;
  busy: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onResume: () => void;
}) {
  const name = useAgentName();
  const { open, toggle } = useCouncilFold(state.status === "done");
  const count = state.reviewers.length;
  const kept = state.report?.findings.length;
  return (
    <section className="deep-review-council" aria-label="Reviewers">
      <CouncilToggle open={open} onToggle={toggle} members={state.reviewers}>
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
        <div className="deep-review-grid" data-count={count}>
          {state.reviewers.map((r, i) => (
            <CouncilMember
              key={r.chatId}
              number={i + 1}
              agent={r}
              chatId={r.chatId}
              live={state.status === "reviewing"}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
      {!hasLead &&
        (state.status === "stopped" || state.status === "failed") && (
          <CouncilHalted
            text={
              state.status === "stopped"
                ? "Review stopped."
                : "No reviewer finished, so the lead has nothing to check."
            }
            action={state.status === "stopped" ? "Resume review" : "Try again"}
            busy={busy}
            onResume={onResume}
          />
        )}
      {state.status === "leading" && !hasLead && (
        <p className="muted deep-review-handover">
          Handing over to {name(state.lead)}…
        </p>
      )}
    </section>
  );
}
