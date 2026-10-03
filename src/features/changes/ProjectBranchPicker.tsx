// Searchable branch menu follows T3 Code's BranchToolbarBranchSelector.
import { memo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  ChevronDown,
  Search,
  Plus,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { api } from "../../lib/api";
import { workingTreeKey } from "../../lib/working-tree-key";
import { Spinner } from "../../ui/ui";
import {
  RebaseConflictCard,
  resolvePrompt,
  type RebaseConflict,
} from "./RebaseConflict";
import type { BranchAction } from "../../../shared/branches";
import {
  checkoutChanged,
  isGitMissing,
  type WorkingTree,
} from "../../../shared/working-tree";
import "../projects/projects.css";
import "./branch-picker.css";
export const ProjectBranchPicker = memo(function ProjectBranchPicker({
  projectId,
  branch,
  disabled,
  onStartThread,
}: {
  projectId: string;
  branch?: string | null;
  disabled: boolean;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const refs = useQuery({
    queryKey: ["project-branches", projectId],
    queryFn: () => api.projectBranches(projectId),
    enabled: open,
    staleTime: 0,
  });
  const treeKey = workingTreeKey(projectId);
  // A branch change can touch anything shown, but it just talked to the
  // upstream (or didn't need to), so the periodic fetch can wait its turn.
  const everythingButFetch = {
    predicate: (q: { queryKey: readonly unknown[] }) =>
      q.queryKey[0] !== "project-fetch",
  };
  const tree = useQuery({
    queryKey: treeKey,
    queryFn: () => api.projectWorkingTree(projectId),
  });
  // Keep "behind" honest: refresh the upstream on focus and every few minutes.
  const remote = useQuery({
    queryKey: ["project-fetch", projectId],
    queryFn: async () => {
      qc.setQueryData<WorkingTree>(
        treeKey,
        await api.projectGitAction(projectId, { kind: "fetch" }),
      );
      return Date.now();
    },
    enabled: !!tree.data?.upstream,
    staleTime: 60_000,
    refetchInterval: 180_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const [conflict, setConflict] = useState<RebaseConflict>();
  const [conflictOpen, setConflictOpen] = useState(false);
  const t = tree.data;
  // Without it the label would say it's loading forever.
  const branchError = branch === undefined ? tree.error : null;
  const sync =
    !t?.upstream || !t.branch || t.operation || (!t.ahead && !t.behind)
      ? null
      : t.ahead && t.behind
        ? "rebase"
        : t.behind
          ? "pull"
          : "push";
  // A conflict stands until either side moves.
  const clash =
    sync === "rebase" &&
    conflict?.tree.head === t?.head &&
    conflict?.tree.behind === t?.behind
      ? conflict
      : undefined;
  async function runSync() {
    if (!t || syncing || !sync || clash) return;
    setSyncing(true);
    setSyncError(undefined);
    const run = async (current: WorkingTree) => {
      if (sync !== "rebase")
        return api.projectGitAction(projectId, {
          kind: sync,
          revision: current.revision,
        });
      const result = await api.projectRebase(projectId, current.head);
      if (!result.rebased) {
        setConflict(result);
        setConflictOpen(true);
      }
      return result.tree;
    };
    try {
      let next: WorkingTree;
      try {
        next = await run(t);
      } catch (e) {
        // The view can be a poll behind the checkout. Look again, and go on
        // only if it still calls for the very same pull or push.
        const fresh = (await tree.refetch()).data;
        if (
          !(e instanceof Error && e.message.startsWith(checkoutChanged)) ||
          !fresh ||
          fresh.branch !== t.branch ||
          fresh.ahead !== t.ahead ||
          fresh.behind !== t.behind
        )
          throw e;
        next = await run(fresh);
      }
      qc.setQueryData<WorkingTree>(treeKey, next);
      void qc.invalidateQueries(everythingButFetch);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
      await tree.refetch();
    } finally {
      setSyncing(false);
    }
  }
  const query = search.trim();
  const allMatches =
    refs.data?.branches.filter((b) =>
      b.name.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const matches = allMatches.slice(0, 100);
  const create =
    !!query &&
    !!refs.data &&
    !refs.data.branches.some((b) => !b.remote && b.name === query);
  const items = [...matches.map((b) => b.ref), ...(create ? ["create"] : [])];
  async function choose(value: string) {
    if (!refs.data || pending || disabled) return;
    if (refs.data.branches.find((b) => b.ref === value)?.current) {
      setOpen(false);
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const action: BranchAction = {
        kind: value === "create" ? "create" : "switch",
        name: value === "create" ? query : value,
        head: refs.data.head,
        current: refs.data.current,
      };
      await api.projectChangeBranch(projectId, action);
      setOpen(false);
      // Done once the checkout moved; the rest catches up on its own, and a
      // slow query shouldn't hold the picker open and disabled meanwhile.
      void qc.invalidateQueries(everythingButFetch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refs.refetch();
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (next) {
            setSearch("");
            setError(undefined);
          }
        }}
      >
        <Popover.Trigger
          className="composer-branch-trigger"
          disabled={disabled}
          title={
            branchError
              ? branchError.message
              : disabled
                ? "Save your edits and wait for the agent before switching branches"
                : "Switch or create a branch"
          }
        >
          <GitBranch size={13} />
          <span>
            {branch !== undefined
              ? branch || "Detached HEAD"
              : !branchError
                ? "Loading branch…"
                : isGitMissing(branchError)
                  ? "Git unavailable"
                  : "Branch unavailable"}
          </span>
          <ChevronDown size={12} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="headline-project-positioner"
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
          >
            <Popover.Popup
              className="headline-project-popup branch-picker-popup"
              aria-label="Switch branch"
              initialFocus={input}
            >
              <Combobox.Root<string>
                inline
                open
                autoHighlight
                items={items}
                filter={null}
                inputValue={search}
                onInputValueChange={setSearch}
                value={null}
                onValueChange={(value) => {
                  if (value) void choose(value);
                }}
              >
                <div className="headline-project-search">
                  <Search size={15} />
                  <Combobox.Input
                    ref={input}
                    aria-label="Search branches"
                    placeholder="Search branches…"
                    disabled={pending}
                    spellCheck={false}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && !pending) {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpen(false);
                      }
                    }}
                  />
                </div>
                <div className="headline-project-scroll">
                  <Combobox.List aria-label="Branches">
                    {matches.map((b, index) => (
                      <Combobox.Item
                        key={b.ref}
                        value={b.ref}
                        index={index}
                        disabled={pending || (b.worktree && !b.current)}
                        className="branch-picker-row"
                        data-current={b.current ? "" : undefined}
                      >
                        <span>{b.name}</span>
                        <small>
                          {b.current
                            ? "current"
                            : b.worktree
                              ? "worktree"
                              : b.remote
                                ? "remote"
                                : ""}
                        </small>
                      </Combobox.Item>
                    ))}
                    {create && (
                      <Combobox.Item
                        value="create"
                        index={matches.length}
                        disabled={pending}
                        className="branch-picker-row"
                      >
                        <Plus size={14} />
                        <span>Create branch “{query}”</span>
                      </Combobox.Item>
                    )}
                  </Combobox.List>
                  {refs.isPending && (
                    <p className="headline-project-empty">Loading branches…</p>
                  )}
                  {allMatches.length > 100 && (
                    <p className="headline-project-empty">
                      Type to narrow down {allMatches.length} branches.
                    </p>
                  )}
                </div>
              </Combobox.Root>
              {(error || refs.error) && (
                <p role="alert" className="branch-picker-error">
                  {error || refs.error?.message}
                </p>
              )}
              <p className="branch-picker-hint">
                {pending
                  ? "Switching branch…"
                  : create
                    ? "New branch starts from the current checkout. Local edits are kept."
                    : "Switches this project’s local checkout. Conflicting edits stay safe."}
              </p>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
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
            disabled={syncing || (sync !== "push" && disabled)}
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
              sync !== "push" && disabled
                ? `Save your edits and wait for the agent before ${sync === "pull" ? "pulling" : "rebasing"}`
                : remote.error
                  ? `Couldn’t fetch ${t.upstream}: ${remote.error.message}`
                  : sync === "rebase" && !clash
                    ? `Rebase your ${t.ahead} onto the ${t.behind} new on ${t.upstream}`
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
        <span role="alert" className="composer-branch-error" title={syncError}>
          {syncError}
        </span>
      )}
    </>
  );
});
