import { useState } from "react";
import { passSlots, type DeepReviewState } from "../../../shared/deep-review";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { formatLines } from "../../../shared/review-passes";
import { CouncilMember } from "./council/CouncilMember";
import { useStartedThreads } from "../agent-turn/StartedThreads";

interface GridProps {
  state: DeepReviewState;
  /** A big council gets smaller panes. */
  many: boolean;
  hasLead: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onStopMember?: (slot: number) => void;
  onResumeMember?: (slot: number) => void;
}

/**
 * The reviewers side by side, each opening its own thread. A split review's
 * come pass by pass: the one at work open, the others a line each that
 * opens the ones done.
 */
export function ReviewerGrid(props: GridProps) {
  const { state } = props;
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());
  if (!state.passes?.length)
    return <Panes {...props} slots={[...state.reviewers.keys()]} />;
  const at = state.pass ?? 0;
  const flip = (i: number) =>
    setFlipped((f) => {
      const next = new Set(f);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  return (
    <div className="deep-review-pass-groups">
      {state.passes.map((pass, i) => {
        const slots = passSlots(state, i);
        const waiting = i > at;
        const open = !waiting && (i === at) !== flipped.has(i);
        return (
          <section key={i} aria-label={`Pass ${i + 1}`}>
            <button
              type="button"
              className="deep-review-pass-head"
              aria-expanded={open}
              disabled={waiting}
              onClick={() => flip(i)}
            >
              <span className="deep-review-slot">{i + 1}</span>
              <span
                className={`deep-review-pass-paths${pass.seams ? " muted" : ""}`}
                title={pass.paths.join(" ")}
              >
                {pass.seams ? "How they fit together" : pass.paths.join(" ")}
              </span>
              <span className="muted">
                {waiting
                  ? "waits its turn"
                  : `${formatLines(pass.lines)}${i < at ? " · done" : ""}`}
              </span>
            </button>
            {open && <Panes {...props} slots={slots} many={slots.length > 4} />}
          </section>
        );
      })}
    </div>
  );
}

/** Reviewers `slots`, numbered as the lead knows them. */
function Panes({
  state,
  slots,
  many,
  hasLead,
  projectRoot,
  onOpenFile,
  onStopMember,
  onResumeMember,
}: GridProps & { slots: number[] }) {
  const started = useStartedThreads();
  return (
    <div
      className="deep-review-grid"
      data-count={slots.length}
      data-many={many || undefined}
    >
      {slots.map((i) => {
        const r = state.reviewers[i]!;
        const thread = started?.threads.find((c) => c.id === r.chatId);
        // Only the pass at work runs; earlier ones are done, later ones wait.
        const live =
          state.status === "reviewing" && (r.pass ?? 0) === (state.pass ?? 0);
        return (
          <CouncilMember
            key={r.chatId}
            number={i + 1}
            agent={r}
            chatId={r.chatId}
            live={live}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
            onStop={onStopMember && live ? () => onStopMember(i) : undefined}
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
