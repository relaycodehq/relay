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
import { api } from "../lib/api";
import { Spinner } from "./ui";
import type { BranchAction } from "../../shared/branches";
import type { WorkingTree } from "../../shared/working-tree";
export const ProjectBranchPicker = memo(function ProjectBranchPicker({
  projectId,
  branch,
  disabled,
}: {
  projectId: string;
  branch?: string | null;
  disabled: boolean;
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
  const treeKey = ["working-tree", "project", projectId];
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
  const t = tree.data;
  const sync =
    !t?.upstream || !t.branch || t.operation || (!t.ahead && !t.behind)
      ? null
      : t.ahead && t.behind
        ? "diverged"
        : t.behind
          ? "pull"
          : "push";
  async function runSync() {
    if (!t || syncing || (sync !== "pull" && sync !== "push")) return;
    setSyncing(true);
    setSyncError(undefined);
    try {
      qc.setQueryData<WorkingTree>(
        treeKey,
        await api.projectGitAction(projectId, {
          kind: sync,
          revision: t.revision,
        }),
      );
      await qc.invalidateQueries();
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
      await qc.invalidateQueries();
      setOpen(false);
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
            disabled
              ? "Save your edits and wait for the agent before switching branches"
              : "Switch or create a branch"
          }
        >
          <GitBranch size={13} />
          <span>
            {branch === undefined
              ? "Loading branch…"
              : branch || "Detached HEAD"}
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
      {sync && t && (
        <button
          type="button"
          className="composer-branch-sync"
          data-state={sync}
          disabled={
            syncing || sync === "diverged" || (sync === "pull" && disabled)
          }
          aria-label={
            sync === "pull"
              ? `Pull ${t.behind} commit${t.behind === 1 ? "" : "s"} from ${t.upstream}`
              : sync === "push"
                ? `Push ${t.ahead} commit${t.ahead === 1 ? "" : "s"} to ${t.pushTarget ?? t.upstream}`
                : `${t.ahead} ahead, ${t.behind} behind ${t.upstream}`
          }
          title={
            sync === "diverged"
              ? `Diverged from ${t.upstream}: rebase or merge before syncing`
              : sync === "pull" && disabled
                ? "Save your edits and wait for the agent before pulling"
                : remote.error
                  ? `Couldn’t fetch ${t.upstream}: ${remote.error.message}`
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
        </button>
      )}
      {syncError && (
        <span role="alert" className="composer-branch-error" title={syncError}>
          {syncError}
        </span>
      )}
    </>
  );
});
