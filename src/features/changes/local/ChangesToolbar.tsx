import { createPortal } from "react-dom";
import { ArrowUp, FolderTree, GitBranch, List, RefreshCw } from "lucide-react";
import type { WorkingTree } from "../../../../shared/working-tree";
import { IconButton } from "../../../ui/ui";
import type { PaneSlots } from "../../../ui/WorkspacePanes";

/**
 * The branch, how far it is from its upstream, and the list's actions: in
 * the workspace pane's header when hosted there, else in its own toolbar.
 */
export function ChangesToolbar({
  slots,
  tree,
  busy,
  grouped,
  onGrouped,
  onRefresh,
  onPush,
}: {
  slots?: PaneSlots;
  tree?: WorkingTree;
  busy: boolean;
  grouped: boolean;
  onGrouped: (grouped: boolean) => void;
  onRefresh: () => void;
  onPush: () => void;
}) {
  const actions = (
    <>
      <span className="change-list-view">
        <IconButton
          label="Group by folder"
          active={grouped}
          onClick={() => onGrouped(true)}
        >
          <FolderTree size={14} />
        </IconButton>
        <IconButton
          label="Flat list"
          active={!grouped}
          onClick={() => onGrouped(false)}
        >
          <List size={14} />
        </IconButton>
      </span>
      <IconButton
        label="Refresh local changes"
        disabled={busy}
        onClick={onRefresh}
      >
        <RefreshCw size={15} />
      </IconButton>
      <button
        disabled={busy || !tree?.pushTarget || !!tree.operation || !tree.branch}
        onClick={onPush}
      >
        <ArrowUp size={15} />
        Push…
      </button>
    </>
  );
  if (slots)
    return (
      <>
        {slots.title &&
          createPortal(
            <>
              <span className="pane-chip">
                <GitBranch size={12} />
                {tree?.branch || "Local checkout"}
              </span>
              {tree?.upstream && (tree.ahead > 0 || tree.behind > 0) && (
                <span className="pane-chip">
                  {tree.ahead > 0 && `↑${tree.ahead}`}
                  {tree.ahead > 0 && tree.behind > 0 && " "}
                  {tree.behind > 0 && `↓${tree.behind}`}
                </span>
              )}
            </>,
            slots.title,
          )}
        {slots.actions && createPortal(actions, slots.actions)}
      </>
    );
  return (
    <header className="working-toolbar">
      <GitBranch size={15} />
      <strong>{tree?.branch || "Local checkout"}</strong>
      {tree?.upstream && (
        <span className="muted">
          {tree.ahead} ahead · {tree.behind} behind
        </span>
      )}
      <span className="spacer" />
      {actions}
    </header>
  );
}
