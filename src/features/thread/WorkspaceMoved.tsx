import type { WorkspaceMove } from "../../../shared/projects";
import { workspaceMoveLine } from "../../../shared/workspace-moves";

/** Something moved the thread's workspace since it was last looked at. */
export const MovedDot = () => (
  <i className="worktree-dot" aria-label="Changed since you last looked" />
);

/** What moved the thread's workspace, at the top of its menu. */
export function MovedNote({ move }: { move: WorkspaceMove }) {
  return (
    <div className="composer-menu-label worktree-moved-note">
      {workspaceMoveLine(move)}
    </div>
  );
}
