import { useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { BranchList } from "../../../shared/branches";
import { api } from "../../lib/api";
import { SearchSelect } from "../../ui/SearchSelect";
import { branchOptions, branchSelect, markCheckedOut } from "./branch-options";

/**
 * The composer's branch list, whatever picking one does: Base, Worktrees and
 * Other branches with their ages, the merged ones folded, and where each is
 * checked out said in muted text.
 */
export function BranchSelect({
  projectId,
  branches,
  names = (list) => list.branches.map((b) => b.name),
  keepRemotes,
  value,
  onPick,
  unpickable,
  create,
  footer,
  trigger,
  triggerLabel,
  triggerTitle,
  disabled,
  open,
  onOpenChange,
}: {
  projectId: string;
  /** The owner's branch list, which it reads picks against too. */
  branches: UseQueryResult<BranchList>;
  /** The branches to list; all of them by default. */
  names?: (list: BranchList) => string[];
  /** Lists a remote branch next to its local one at the same commit. */
  keepRemotes?: boolean;
  /** The branch checked in the list. */
  value?: string | null;
  onPick: (name: string, list: BranchList) => void;
  /** Listed but greyed out, like a branch another worktree holds. */
  unpickable?: (name: string, list: BranchList) => boolean;
  create?: {
    label: (search: string) => string | undefined;
    onSelect: (search: string) => void;
  };
  footer?: ReactNode;
  trigger: ReactNode;
  triggerLabel?: string;
  triggerTitle?: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [shown, setShown] = useState(false);
  // Ahead counts are their own, slower call, made only once the list is opened.
  const counts = useQuery({
    queryKey: ["project-branch-counts", projectId],
    queryFn: () => api.projectBranchCounts(projectId),
    enabled: open ?? shown,
  });
  const list = branches.data;
  const options = list
    ? markCheckedOut(
        branchOptions(names(list), list, counts.data, Date.now(), {
          keepRemotes,
        }),
        list,
      ).map((o) => (unpickable?.(o.value, list) ? { ...o, disabled: true } : o))
    : [];
  return (
    <SearchSelect
      label="Branches"
      value={value ?? undefined}
      options={options}
      onChange={(name) => list && onPick(name, list)}
      open={open}
      onOpenChange={(next) => {
        setShown(next);
        onOpenChange?.(next);
      }}
      trigger={trigger}
      triggerLabel={triggerLabel}
      triggerTitle={triggerTitle}
      triggerClassName="composer-branch-trigger"
      disabled={disabled}
      placeholder="Search branches…"
      limit={100}
      create={create}
      footer={footer}
      empty={
        branches.isError
          ? "Couldn't list the branches."
          : branches.isPending
            ? "Loading branches…"
            : "No branches to pick."
      }
      {...branchSelect}
    />
  );
}
