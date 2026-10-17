import { createPortal } from "react-dom";
import type { WorktreeStatus } from "../../../shared/projects";
import type { PaneSlots } from "../../ui/WorkspacePanes";
import "./worktree-switch.css";

/**
 * A worktree thread's two views of Changes, in the pane's title: what isn't
 * committed yet, and everything its branch has that the source branch doesn't.
 * Neither is picked while a turn's diff shows.
 */
export function WorktreeSwitch({
  slots,
  status,
  showing,
  onUncommitted,
  onAgainstSource,
}: {
  slots: PaneSlots;
  status: WorktreeStatus;
  showing: "uncommitted" | "source" | "turn";
  onUncommitted: () => void;
  onAgainstSource: () => void;
}) {
  if (!slots.title) return null;
  const from = status.from ?? "its source branch";
  return createPortal(
    <div className="worktree-switch" role="tablist">
      <button
        role="tab"
        aria-selected={showing === "uncommitted"}
        className={showing === "uncommitted" ? "active" : ""}
        title="What isn't committed yet"
        onClick={onUncommitted}
      >
        Uncommitted
      </button>
      <button
        role="tab"
        aria-selected={showing === "source"}
        className={showing === "source" ? "active" : ""}
        aria-label={`Against ${from}`}
        title={`Everything this worktree has that ${from} doesn't, committed or not`}
        onClick={onAgainstSource}
      >
        <span className="worktree-switch-against">Against</span>
        <span className="worktree-switch-vs">vs</span>
        <span className="worktree-switch-from">{from}</span>
      </button>
    </div>,
    slots.title,
  );
}
