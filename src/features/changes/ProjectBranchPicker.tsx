import { memo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  ChevronDown,
  ArrowDown,
  ArrowUp,
  CircleAlert,
} from "lucide-react";
import { api } from "../../lib/api";
import { Spinner } from "../../ui/ui";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { RebaseConflictCard, resolvePrompt } from "./RebaseConflict";
import { everythingButFetch, useBranchSync } from "./useBranchSync";
import { BranchSelect } from "./BranchSelect";
import {
  localTwin,
  type BranchAction,
  type BranchList,
} from "../../../shared/branches";
import { isGitMissing } from "../../../shared/working-tree";
import "../projects/projects.css";
import "./branch-picker.css";

/** A pick in the picker: an existing branch by name, or one to create. */
export interface BranchChoice {
  name: string;
  create: boolean;
}

/**
 * Before a new thread's first message, a pick may mean working on the branch
 * somewhere else than the checkout, so nothing about the checkout locks it.
 */
export interface BranchPickInterceptor {
  /** Switching the checkout is held off for now; picking still works. */
  locked: boolean;
  /** Whether to switch the checkout as usual; false when the pick was taken care of. */
  pick: (choice: BranchChoice, list: BranchList) => boolean;
  /** The checkout refused to switch, `reason` saying why. */
  refused: (choice: BranchChoice, reason: string, list: BranchList) => void;
}

export const ProjectBranchPicker = memo(function ProjectBranchPicker({
  projectId,
  branch,
  disabled,
  intercept,
  onStartThread,
}: {
  projectId: string;
  branch?: string | null;
  disabled: boolean;
  intercept?: BranchPickInterceptor;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // Read where the list asks to close right after a pick, before a render.
  const switching = useRef(false);
  const [error, setError] = useState<string>();
  const qc = useQueryClient();
  const refs = useQuery({
    queryKey: ["project-branches", projectId],
    queryFn: () => api.projectBranches(projectId),
    enabled: open,
    staleTime: 0,
  });
  const {
    tree,
    t,
    remote,
    sync,
    clash,
    syncing,
    syncError,
    conflictOpen,
    setConflictOpen,
    runSync,
  } = useBranchSync(projectId);
  // Without it the label would say it's loading forever.
  const branchError = branch === undefined ? tree.error : null;
  // What changes the checkout in place waits, even when a pick has somewhere else to go.
  const held = disabled || !!intercept?.locked;
  const [creating, setCreating] = useState(false);
  async function choose(choice: BranchChoice, list: BranchList) {
    if (switching.current || disabled) return;
    const picked = list.branches.find((b) => b.name === choice.name);
    if (!choice.create && (!picked || picked.current)) {
      setOpen(false);
      return;
    }
    if (intercept && !intercept.pick(choice, list)) {
      setOpen(false);
      return;
    }
    switching.current = true;
    setPending(true);
    setCreating(choice.create);
    setError(undefined);
    try {
      const action: BranchAction = {
        kind: choice.create ? "create" : "switch",
        name: choice.create ? choice.name : picked!.ref,
        head: list.head,
        current: list.current,
      };
      await api.projectChangeBranch(projectId, action);
      setOpen(false);
      // Done once the checkout moved; the rest catches up on its own, and a
      // slow query shouldn't hold the picker open and disabled meanwhile.
      void qc.invalidateQueries(everythingButFetch);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (intercept) {
        setOpen(false);
        intercept.refused(choice, reason, list);
        return;
      }
      setError(reason);
      await refs.refetch();
    } finally {
      switching.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <BranchSelect
        projectId={projectId}
        branches={refs}
        value={branch}
        open={open}
        onOpenChange={(next) => {
          if (switching.current) return;
          setOpen(next);
          if (next) setError(undefined);
        }}
        onPick={(name, list) => void choose({ name, create: false }, list)}
        // Picking a remote checks out its local twin when there is one.
        unpickable={(name, list) => {
          if (intercept) return false;
          const b = list.branches.find((x) => x.name === name);
          const own = b && (localTwin(list.branches, b) ?? b);
          return !!own?.worktree && !own.current;
        }}
        create={{
          label: (search) =>
            refs.data?.branches.some((b) => !b.remote && b.name === search)
              ? undefined
              : `Create branch “${search}”`,
          onSelect: (search) =>
            refs.data && void choose({ name: search, create: true }, refs.data),
        }}
        footer={
          <>
            {(error || refs.error) && (
              <p role="alert" className="branch-picker-error">
                {error || refs.error?.message}
              </p>
            )}
            <p className="branch-picker-hint">
              {pending
                ? creating
                  ? "Creating branch…"
                  : "Switching branch…"
                : intercept?.locked
                  ? "Your checkout is busy, so a branch picked here gets a worktree of its own."
                  : intercept
                    ? "Switches this project’s local checkout. A branch in a worktree is worked on there."
                    : "Switches this project’s local checkout. Conflicting edits stay safe."}
            </p>
          </>
        }
        disabled={disabled}
        triggerTitle={
          branchError
            ? branchError.message
            : disabled
              ? "Save your edits and wait for the agent before switching branches"
              : "Switch or create a branch"
        }
        trigger={
          <>
            <GitBranch size={13} />
            {branch ? (
              <MiddleTruncate text={branch} kind="branch" />
            ) : (
              <span>
                {branch !== undefined
                  ? "Detached HEAD"
                  : !branchError
                    ? "Loading branch…"
                    : isGitMissing(branchError)
                      ? "Git unavailable"
                      : "Branch unavailable"}
              </span>
            )}
            <ChevronDown size={12} />
          </>
        }
      />
      {t?.operation?.startsWith("rebase") && (
        <span
          className="composer-branch-trigger workspace-trigger static composer-branch-rebasing"
          title="A rebase is in progress in this folder"
        >
          Rebasing…
        </span>
      )}
      {sync && t && (
        <Popover.Root
          open={conflictOpen && !!clash}
          onOpenChange={(next) => setConflictOpen(next && !!clash)}
        >
          <Popover.Trigger
            className="composer-branch-sync"
            data-state={clash ? "conflict" : sync}
            disabled={syncing || (sync !== "push" && held)}
            aria-label={
              clash
                ? `Couldn’t rebase onto ${t.upstream}`
                : sync === "pull"
                  ? `Pull ${t.behind} commit${t.behind === 1 ? "" : "s"} from ${t.upstream}`
                  : sync === "push"
                    ? `Push ${t.ahead} commit${t.ahead === 1 ? "" : "s"} to ${t.pushTarget ?? t.upstream}`
                    : `Rebase ${t.ahead} commit${t.ahead === 1 ? "" : "s"} onto ${t.upstream}`
            }
            title={
              sync !== "push" && held
                ? `Save your edits and wait for the agent before ${sync === "pull" ? "pulling" : "rebasing"}`
                : remote.error
                  ? `Couldn’t fetch ${t.upstream}: ${remote.error.message}`
                  : sync === "rebase" && !clash
                    ? `Rebase your ${t.ahead} onto the ${t.behind} new on ${t.upstream}`
                    : !t.upstream
                      ? `Not on ${t.pushTarget} yet. Push ${t.ahead} commit${t.ahead === 1 ? "" : "s"}`
                      : undefined
            }
            onClick={() => void runSync()}
          >
            {syncing ? (
              <Spinner size={12} />
            ) : (
              <>
                {t.behind > 0 && (
                  <span>
                    <ArrowDown size={12} />
                    {t.behind}
                  </span>
                )}
                {t.ahead > 0 && (
                  <span>
                    <ArrowUp size={12} />
                    {t.ahead}
                  </span>
                )}
              </>
            )}
          </Popover.Trigger>
          {clash && (
            <Popover.Portal>
              <Popover.Positioner
                className="composer-popup-positioner"
                side="top"
                align="end"
                sideOffset={6}
              >
                <Popover.Popup className="composer-select-popup rebase-conflict-card">
                  <RebaseConflictCard
                    conflict={clash}
                    onResolve={
                      onStartThread &&
                      ((draft) => {
                        setConflictOpen(false);
                        void onStartThread(
                          resolvePrompt(t.branch, clash),
                          !draft,
                        );
                      })
                    }
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          )}
        </Popover.Root>
      )}
      {syncError && (
        <Tooltip.Root>
          <span role="alert" className="sr-only">
            {syncError}
          </span>
          <Tooltip.Trigger
            className="composer-branch-error"
            aria-label={`Git sync failed: ${syncError}`}
            delay={200}
          >
            <CircleAlert size={14} aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner
              className="composer-popup-positioner"
              side="top"
              align="end"
              sideOffset={6}
              collisionPadding={12}
            >
              <Tooltip.Popup
                role="tooltip"
                className="composer-branch-error-tooltip"
              >
                {syncError}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}
    </>
  );
});
