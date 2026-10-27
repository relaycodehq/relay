import { useQuery } from "@tanstack/react-query";
import { ChevronDown, GitBranch } from "lucide-react";
import { api } from "../../lib/api";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { BranchSelect } from "./BranchSelect";
import { BranchSyncControl } from "./BranchSyncControl";
import { useBranchSync } from "./useBranchSync";
import "./branch-picker.css";

/**
 * A worktree thread's branch, synced just like the checkout's. With
 * `onPick`, picking another takes the thread to wherever that branch is
 * worked on; without, as in a review, it only shows.
 */
export function WorktreeBranch({
  projectId,
  where,
  branch,
  held,
  onPick,
}: {
  projectId: string;
  where: string;
  branch: string | null | undefined;
  held: boolean;
  onPick?: (branch: string) => void;
}) {
  const state = useBranchSync(where);
  const current = state.t ? state.t.branch : branch;
  const branches = useQuery({
    queryKey: ["project-branches", projectId],
    queryFn: () => api.projectBranches(projectId),
    staleTime: 5_000,
    enabled: !!onPick,
  });
  const label = current ? (
    <MiddleTruncate text={current} kind="branch" />
  ) : (
    <span>Detached HEAD</span>
  );
  if (!onPick)
    return (
      <>
        <span
          className="composer-branch-trigger workspace-trigger static worktree-branch"
          title="This thread's worktree branch"
        >
          <GitBranch size={13} />
          {label}
        </span>
        <BranchSyncControl state={state} held={held} />
      </>
    );
  return (
    <>
      <BranchSelect
        projectId={projectId}
        branches={branches}
        value={current}
        onPick={(name) => {
          if (name !== current) onPick(name);
        }}
        onOpenChange={(open) => {
          if (open) void branches.refetch();
        }}
        disabled={held}
        triggerTitle={
          held
            ? "Wait for the agent before switching branches"
            : "Switch this thread's branch"
        }
        footer={
          <p className="branch-picker-hint">
            Switches this thread’s worktree. A branch checked out elsewhere is
            worked on there.
          </p>
        }
        trigger={
          <>
            <GitBranch size={13} />
            {label}
            <ChevronDown size={12} />
          </>
        }
      />
      <BranchSyncControl state={state} held={held} />
    </>
  );
}
