import { memo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { Tooltip } from "@base-ui/react/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  ChevronDown,
  Search,
  Plus,
  ArrowDown,
  ArrowUp,
  CircleAlert,
} from "lucide-react";
import { api } from "../../lib/api";
import { Spinner } from "../../ui/ui";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { RebaseConflictCard, resolvePrompt } from "./RebaseConflict";
import { everythingButFetch, useBranchSync } from "./useBranchSync";
import { localTwin, type BranchAction } from "../../../shared/branches";
import { isGitMissing } from "../../../shared/working-tree";
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
                onInputValueChange={(value) => {
                  setSearch(value);
                  setError(undefined);
                }}
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
                    {matches.map((b) => {
                      // Picking a remote checks out its local twin when there is one.
                      const own = localTwin(refs.data?.branches ?? [], b) ?? b;
                      const elsewhere = own.worktree && !own.current;
                      return (
                        <Combobox.Item
                          key={b.ref}
                          value={b.ref}
                          disabled={pending || elsewhere}
                          className="branch-picker-row"
                          data-current={b.current ? "" : undefined}
                        >
                          <MiddleTruncate text={b.name} kind="branch" />
                          <small>
                            {b.current
                              ? "current"
                              : elsewhere
                                ? "worktree"
                                : b.remote
                                  ? "remote"
                                  : ""}
                          </small>
                        </Combobox.Item>
                      );
                    })}
                    {create && (
                      <Combobox.Item
                        value="create"
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
