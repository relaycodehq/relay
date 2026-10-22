import { GitBranch } from "lucide-react";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { BranchSyncControl } from "./BranchSyncControl";
import { useBranchSync } from "./useBranchSync";

/** A worktree keeps its branch, but syncs it just like the checkout does. */
export function WorktreeBranch({
  where,
  branch,
  held,
}: {
  where: string;
  branch: string | null | undefined;
  held: boolean;
}) {
  const state = useBranchSync(where);
  const current = state.t ? state.t.branch : branch;
  return (
    <>
      <span
        className="composer-branch-trigger workspace-trigger static worktree-branch"
        title="This thread's worktree branch"
      >
        <GitBranch size={13} />
        {current ? (
          <MiddleTruncate text={current} kind="branch" />
        ) : (
          <span>Detached HEAD</span>
        )}
      </span>
      <BranchSyncControl state={state} held={held} />
    </>
  );
}
