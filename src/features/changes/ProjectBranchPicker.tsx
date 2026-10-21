import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { BranchSyncControl } from "./BranchSyncControl";
import { everythingButFetch, useBranchSync } from "./useBranchSync";
import { BranchSelect } from "./BranchSelect";
import {
  localTwinName,
  type BranchAction,
  type BranchList,
} from "../../../shared/branches";
import { isGitMissing } from "../../../shared/working-tree";
import "../projects/projects.css";
import "./branch-picker.css";
import { errorMessage } from "../../../shared/error-message";

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
  const syncState = useBranchSync(projectId);
  // Without it the label would say it's loading forever.
  const branchError = branch === undefined ? syncState.tree.error : null;
  // What changes the checkout in place waits, even when a pick has somewhere else to go.
  const held = disabled || !!intercept?.locked;
  // Another worktree holds them, so the checkout can't switch to them;
  // picking a remote checks out its local twin when there is one.
  const intercepting = !!intercept;
  const taken = useMemo(() => {
    const list = refs.data;
    if (intercepting || !list) return undefined;
    const local = new Map(
      list.branches.filter((b) => !b.remote).map((b) => [b.name, b]),
    );
    return new Set(
      list.branches
        .filter((b) => {
          const own = (b.remote && local.get(localTwinName(b))) || b;
          return !!own.worktree && !own.current;
        })
        .map((b) => b.name),
    );
  }, [refs.data, intercepting]);
  const unpickable = useCallback((name: string) => !!taken?.has(name), [taken]);
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
      const reason = errorMessage(e);
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
        unpickable={unpickable}
        create={{
          // Only once the list is in: it says whether the name is taken, and
          // creating needs it.
          label: (search) =>
            !refs.data ||
            refs.data.branches.some((b) => !b.remote && b.name === search)
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
      <BranchSyncControl
        state={syncState}
        held={held}
        onStartThread={onStartThread}
      />
    </>
  );
});
