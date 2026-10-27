import { ProjectBranchPicker } from "../changes/ProjectBranchPicker";
import { localTwin } from "../../../shared/branches";

/**
 * Where a new review reads: the project folder, switched to the branch
 * picked, or the folder another branch is checked out in, as it is there.
 */
export function ReviewBranchPicker({
  projectId,
  branch,
  on,
  onRead,
  disabled,
  locked,
}: {
  projectId: string;
  /** The project folder's branch. */
  branch?: string;
  /** The branch checked out elsewhere the review reads in instead. */
  on?: string;
  onRead: (on: string | undefined) => void;
  disabled: boolean;
  /** Switching the project folder is held off for now. */
  locked: boolean;
}) {
  return (
    <ProjectBranchPicker
      projectId={projectId}
      branch={on ?? branch}
      disabled={disabled}
      intercept={{
        locked,
        pick: ({ name, create }, list) => {
          const picked = list.branches.find((b) => b.name === name);
          // A remote one whose local branch exists means that branch, as `git switch` has it.
          const own = (picked && localTwin(list.branches, picked)) ?? picked;
          const elsewhere = !create && !!own?.worktree && !own.current;
          onRead(elsewhere ? own!.name : undefined);
          // A branch no folder has checked out is read once the project folder switches to it.
          return !elsewhere && !locked;
        },
      }}
    />
  );
}
