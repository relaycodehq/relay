import type { DeepReviewState } from "../../../shared/deep-review";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { CouncilMember } from "./council/CouncilMember";
import { useStartedThreads } from "../agent-turn/StartedThreads";

/** The reviewers side by side, each opening its own thread. */
export function ReviewerGrid({
  state,
  many,
  hasLead,
  projectRoot,
  onOpenFile,
  onStopMember,
  onResumeMember,
}: {
  state: DeepReviewState;
  /** A big council gets smaller panes. */
  many: boolean;
  hasLead: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onStopMember?: (slot: number) => void;
  onResumeMember?: (slot: number) => void;
}) {
  const started = useStartedThreads();
  const count = state.reviewers.length;
  return (
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
            onOpen={thread && started ? () => started.open(thread) : undefined}
          />
        );
      })}
    </div>
  );
}
