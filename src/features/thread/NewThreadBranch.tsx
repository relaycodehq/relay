import { useQuery } from "@tanstack/react-query";
import { ChevronDown, GitBranch } from "lucide-react";
import type { BranchList } from "../../../shared/branches";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { LOCKED_MESSAGE } from "../../lib/navigation-lock";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { BranchSelect } from "../changes/BranchSelect";
import { ProjectBranchPicker } from "../changes/ProjectBranchPicker";
import type { ThreadWorktree } from "./useThreadWorktree";
import type { ProjectCheckout } from "./ThreadComposer";
import { WorktreeBranchField } from "./WorktreeBranchField";
import {
  branchOffNames,
  carriedBranch,
  detourLine,
  pickBranch,
  type BranchPick,
} from "./worktree-start";
import "../changes/branch-picker.css";

const branchesQuery = (projectId: string) => ({
  queryKey: ["project-branches", projectId],
  queryFn: () => api.projectBranches(projectId),
});

/**
 * Before a thread's first message: the branch it works on, which says where.
 * The checkout's branch switches the checkout; a branch it can't have, being
 * checked out elsewhere or the checkout busy, gets the thread a worktree.
 */
export function NewThreadBranch({
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
  const { start, startOn, setStart, setWorkspace, setStartOn, setDetour } =
    worktree;
  // A later pick says nothing of why an earlier one went to a worktree.
  const go = (pick: BranchPick, reason: string) => {
    setDetour(undefined);
    if (pick.kind === "checkout") {
      setStart(undefined);
      setWorkspace("checkout");
    } else if (pick.kind === "worktree") {
      setStartOn(undefined);
      setWorkspace("worktree");
      setStart(pick.start);
      if (pick.busy && pick.start && "on" in pick.start)
        setDetour({ branch: pick.start.on, reason });
    }
  };
  // A branch to create that the checkout can't take is made in a new worktree.
  const makeElsewhere = (name: string, reason: string) => {
    setStartOn(undefined);
    setWorkspace("worktree");
    setStart(undefined);
    worktree.setNewBranch(name);
    setDetour({ branch: name, reason });
  };
  const field = (
    <WorktreeBranchField
      projectId={project.id}
      value={worktree.newBranch}
      onChange={worktree.setNewBranch}
      disabled={disabled}
    />
  );
  // Starting on another computer, it goes from this branch's last commit.
  if (startOn) return field;
  if (worktree.workspace === "checkout")
    return (
      <ProjectBranchPicker
        projectId={project.id}
        branch={checkout.branch}
        disabled={disabled}
        onStartThread={onStartThread}
        intercept={{
          locked: checkout.locked,
          pick: ({ name, create }, list) => {
            if (create) {
              if (checkout.locked) makeElsewhere(name, LOCKED_MESSAGE);
              return !checkout.locked;
            }
            const next = pickBranch({
              mode: "checkout",
              name,
              list,
              checkout: checkout.branch,
              locked: checkout.locked,
            });
            go(next, LOCKED_MESSAGE);
            return next.kind === "switch";
          },
          refused: ({ name, create }, reason, list) =>
            create
              ? makeElsewhere(name, reason)
              : go(
                  pickBranch({
                    mode: "checkout",
                    name,
                    list,
                    checkout: checkout.branch,
                    locked: true,
                  }),
                  reason,
                ),
        }}
      />
    );
  const on = start && "on" in start;
  const select = (
    <WorktreeBranchSelect
      project={project}
      worktree={worktree}
      checkout={checkout.branch}
      disabled={disabled}
      onPick={(name, list) =>
        go(
          pickBranch({
            mode: on ? "on" : "off",
            name,
            list,
            checkout: checkout.branch,
            locked: checkout.locked,
          }),
          "",
        )
      }
    />
  );
  if (on) return select;
  // One phrase for the new branch: "⑂ named after your message off main".
  return (
    <span className="new-thread-branch">
      {field}
      {select}
    </span>
  );
}

/** The branch a worktree thread works on, or a new worktree's base: "off main". */
function WorktreeBranchSelect({
  project,
  worktree: { start },
  checkout,
  disabled,
  onPick,
}: {
  project: Project;
  worktree: ThreadWorktree;
  checkout?: string | null;
  disabled: boolean;
  onPick: (name: string, list: BranchList) => void;
}) {
  // The trigger makes do with a cached list; an opened one gets it as it is now.
  const branches = useQuery({ ...branchesQuery(project.id), staleTime: 5_000 });
  const on = start && "on" in start ? start.on : undefined;
  const value = on ?? (start && "off" in start ? start.off : checkout);
  const shown = on ? carriedBranch(start, branches.data) : value;
  return (
    <BranchSelect
      projectId={project.id}
      branches={branches}
      names={branchOffNames}
      // Starting off origin/… fetches it first, which its local twin doesn't.
      keepRemotes={!on}
      value={value}
      onPick={onPick}
      onOpenChange={(next) => {
        if (next) void branches.refetch();
      }}
      trigger={
        on ? (
          <>
            <GitBranch size={13} />
            <MiddleTruncate text={shown ?? on} kind="branch" />
            <ChevronDown size={12} />
          </>
        ) : (
          <>
            <span className="new-thread-branch-off">off</span>
            {shown ? (
              <MiddleTruncate text={shown} kind="branch" />
            ) : (
              <span>Detached HEAD</span>
            )}
            <ChevronDown size={12} />
          </>
        )
      }
      triggerLabel={
        on ? `Works on ${shown ?? "a branch"}` : `Off ${shown ?? "HEAD"}`
      }
      disabled={disabled}
    />
  );
}

/** Under the row when a branch picked for the checkout got a worktree instead. */
export function DetourNote({
  project,
  worktree,
}: {
  project: Project;
  worktree: ThreadWorktree;
}) {
  const { detour, start, startOn, workspace, newBranch } = worktree;
  const list = useQuery({ ...branchesQuery(project.id), enabled: false });
  if (!detour || startOn || workspace !== "worktree") return null;
  const carried = start && "on" in start && start.on === detour.branch;
  const made = !start && newBranch.trim() === detour.branch;
  if (!carried && !made) return null;
  return (
    <p className="start-on-note" title={detour.reason}>
      {detourLine(
        detour.reason,
        carried
          ? { carried: carriedBranch(start, list.data) ?? detour.branch }
          : { made: detour.branch },
      )}
    </p>
  );
}
