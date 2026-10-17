import { createPortal } from "react-dom";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import {
  checkoutLabel,
  type WorkingTree,
} from "../../../../shared/working-tree";
import { gitBlockedReason } from "../working-changes";
import { RebaseConflictCard } from "../RebaseConflict";
import { useBranchSync } from "../useBranchSync";
import { IconButton, Spinner } from "../../../ui/ui";
import {
  LOCKED_MESSAGE,
  useNavigationLock,
} from "../../../lib/navigation-lock";
import type { PaneSlots } from "../../../ui/WorkspacePanes";
import { MiddleTruncate } from "../../../ui/MiddleTruncate";
import "../../agents/composer-model-picker.css";

/**
 * The branch, how far it is from its upstream, and the list's actions: in
 * the workspace pane's header when hosted there, else in its own toolbar.
 */
export function ChangesToolbar({
  projectId,
  slots,
  tree,
  busy,
  onRefresh,
  onPush,
  agentRunning = false,
}: {
  /** Set for a project's checkout, which can also pull and rebase from here. */
  projectId?: string;
  slots?: PaneSlots;
  tree?: WorkingTree;
  busy: boolean;
  onRefresh: () => void;
  onPush: () => void;
  /** The thread's agent is at work in this folder: pulling waits for it. */
  agentRunning?: boolean;
}) {
  const blocked = tree && gitBlockedReason(tree, "push");
  // Nothing to push once the upstream has every commit.
  const push = tree && (tree.ahead > 0 || !tree.upstream) && (
    <button
      className="primary"
      disabled={busy || !!blocked}
      title={blocked}
      onClick={onPush}
    >
      <ArrowUp size={15} />
      Push{tree.ahead > 0 && ` ${tree.ahead}`}…
    </button>
  );
  const level = projectId ? (
    <SyncButton
      projectId={projectId}
      busy={busy}
      agentRunning={agentRunning}
      push={push}
    />
  ) : (
    push
  );
  const refresh = (
    <IconButton
      label="Refresh local changes"
      disabled={busy}
      onClick={onRefresh}
    >
      <RefreshCw size={15} />
    </IconButton>
  );
  const actions = (
    <>
      {refresh}
      {level}
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
                <MiddleTruncate
                  text={tree ? checkoutLabel(tree) : "Local checkout"}
                  kind="branch"
                />
              </span>
              {tree && (tree.ahead > 0 || tree.behind > 0) && (
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
  const away =
    tree &&
    [
      tree.ahead > 0 && `${tree.ahead} to push`,
      tree.behind > 0 && `${tree.behind} to pull`,
    ].filter(Boolean);
  return (
    <header className="working-toolbar">
      <GitBranch size={15} />
      <strong>{tree ? checkoutLabel(tree) : "Local checkout"}</strong>
      {tree &&
        (!tree.upstream ? (
          <span className="muted">not on a remote yet</span>
        ) : away?.length ? (
          <span className="muted">{away.join(" · ")}</span>
        ) : (
          <span className="muted working-synced">
            <Check size={12} />
            in sync with {tree.upstream}
          </span>
        ))}
      <span className="spacer" />
      {refresh}
      {level}
    </header>
  );
}

/** The one step that levels the branch with its upstream: push, pull or rebase. */
function SyncButton({
  projectId,
  busy,
  agentRunning,
  push,
}: {
  projectId: string;
  busy: boolean;
  agentRunning: boolean;
  push: React.ReactNode;
}) {
  // As in the branch picker: the checkout doesn't move under a running
  // agent or an unsaved edit.
  const { locked } = useNavigationLock();
  const {
    t,
    sync,
    clash,
    syncing,
    syncError,
    conflictOpen,
    setConflictOpen,
    runSync,
  } = useBranchSync(projectId);
  if (!t || (sync !== "pull" && sync !== "rebase")) return push;
  const n = (count: number) => `${count} commit${count === 1 ? "" : "s"}`;
  return (
    <>
      {syncError && (
        <span className="working-sync-error" role="alert" title={syncError}>
          {syncError}
        </span>
      )}
      <Popover.Root
        open={conflictOpen && !!clash}
        onOpenChange={(next) => setConflictOpen(next && !!clash)}
      >
        <Popover.Trigger
          className="primary"
          disabled={busy || syncing || locked || agentRunning}
          title={
            locked
              ? LOCKED_MESSAGE
              : agentRunning
                ? "Pull once the agent is done"
                : clash
                  ? `Couldn’t rebase onto ${t.upstream}`
                  : sync === "pull"
                    ? `Pull ${n(t.behind)} from ${t.upstream}`
                    : `Pull ${n(t.behind)} from ${t.upstream} and put your ${n(t.ahead)} on top`
          }
          onClick={() => void runSync()}
        >
          {syncing ? <Spinner size={13} /> : <ArrowDown size={15} />}
          {sync === "pull" ? `Pull ${t.behind}` : `Pull ${t.behind} & rebase`}
        </Popover.Trigger>
        {clash && (
          <Popover.Portal>
            <Popover.Positioner
              className="composer-popup-positioner"
              side="bottom"
              align="end"
              sideOffset={6}
            >
              <Popover.Popup className="composer-select-popup rebase-conflict-card">
                <RebaseConflictCard conflict={clash} />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        )}
      </Popover.Root>
    </>
  );
}
