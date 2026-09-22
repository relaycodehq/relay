// Searchable branch menu follows T3 Code's BranchToolbarBranchSelector.
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, ChevronDown, Search, Plus } from "lucide-react";
import { api } from "../lib/api";
import type { BranchAction } from "../../shared/branches";
export function ProjectBranchPicker({
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
          {branch === undefined ? "Loading branch…" : branch || "Detached HEAD"}
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
  );
}
