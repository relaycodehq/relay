import type { Project } from "../../../shared/projects";
import { WorktreeBranch } from "../changes/WorktreeBranch";
import {
  ProjectBranchPicker,
  type BranchPickInterceptor,
} from "../changes/ProjectBranchPicker";
import type { ProjectCheckout } from "./ThreadComposer";
import type { ThreadWorktree } from "./useThreadWorktree";
import { pickBranch } from "./worktree-start";

/**
 * A started thread's branch. Picking one takes the thread there: the
 * checkout switches when it can, and a branch it can't have, being checked
 * out elsewhere or the checkout busy, moves the thread to a worktree on it.
 */
export function StartedThreadBranch({
  project,
  worktree,
  checkout,
  disabled,
  onStartThread,
}: {
  project: Project;
  worktree: ThreadWorktree;
  checkout: ProjectCheckout;
  disabled: boolean;
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  if (worktree.inWorktree)
    return (
      <WorktreeBranch
        key={worktree.where}
        projectId={project.id}
        where={worktree.where}
        branch={worktree.branch}
        held={disabled || worktree.selectionDisabled}
        onPick={
          worktree.branchSwitchable
            ? (branch) => void worktree.workOn(branch)
            : undefined
        }
      />
    );
  const moves: BranchPickInterceptor = {
    locked: checkout.locked,
    pick: ({ name, create }, list) => {
      // A new branch is made in the checkout, which waits while it's busy.
      if (create) return !checkout.locked;
      const next = pickBranch({
        mode: "checkout",
        name,
        list,
        checkout: checkout.branch,
        locked: checkout.locked,
      });
      if (next.kind === "worktree") void worktree.workOn(name);
      return next.kind === "switch";
    },
    refused: ({ name, create }, reason) => {
      if (create) worktree.showError(reason);
      else void worktree.workOn(name);
    },
  };
  return (
    <ProjectBranchPicker
      projectId={project.id}
      branch={checkout.branch}
      // A review only switches the checkout, as it always did.
      disabled={disabled || (!worktree.branchSwitchable && checkout.locked)}
      onStartThread={onStartThread}
      intercept={worktree.branchSwitchable ? moves : undefined}
    />
  );
}
