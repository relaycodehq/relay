import { Menu } from "@base-ui/react/menu";
import {
  Check,
  ChevronDown,
  Folder,
  FolderGit2,
  GitMerge,
  GitPullRequest,
  TriangleAlert,
} from "lucide-react";
import type {
  AgentWorktree,
  ChatWorkspace,
  WorktreeStatus,
} from "../../shared/projects";
import { Modal } from "./ui";
import "./worktrees.css";

const workspaces: Record<
  ChatWorkspace,
  { label: string; icon: typeof Folder }
> = {
  checkout: { label: "Current checkout", icon: Folder },
  worktree: { label: "New worktree", icon: FolderGit2 },
};

/** Before a thread's first message: where it will work. */
export function WorkspacePicker({
  value,
  onChange,
  disabled,
}: {
  value: ChatWorkspace;
  onChange: (value: ChatWorkspace) => void;
  disabled?: boolean;
}) {
  const Icon = workspaces[value].icon;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger"
        disabled={disabled}
        title="Where this thread works"
      >
        <Icon size={13} />
        <span>{workspaces[value].label}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className="composer-select-popup" aria-label="Workspace">
            <Menu.Group>
              <Menu.GroupLabel className="composer-menu-label">
                Workspace
              </Menu.GroupLabel>
              {(Object.keys(workspaces) as ChatWorkspace[]).map((w) => {
                const ItemIcon = workspaces[w].icon;
                return (
                  <Menu.Item
                    key={w}
                    className="composer-select-item workspace-item"
                    onClick={() => onChange(w)}
                  >
                    <ItemIcon size={14} />
                    {workspaces[w].label}
                  </Menu.Item>
                );
              })}
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const folderName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * A checkout thread, plus any worktree its agent made with git on its own:
 * that's where its edits go, so the footer has to say so.
 */
export function CheckoutControl({
  worktrees = [],
  onReveal,
}: {
  worktrees?: AgentWorktree[];
  onReveal: (path: string) => void;
}) {
  if (!worktrees.length)
    return (
      <span
        className="composer-branch-trigger workspace-trigger static"
        title="This thread works in the project's checkout"
      >
        <Folder size={13} />
        <span>Current checkout</span>
      </span>
    );
  const [latest] = worktrees.slice(-1);
  return (
    <Menu.Root>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger agent-worktree-trigger"
        title={`The agent made ${worktrees.length === 1 ? "a worktree" : "worktrees"} outside the checkout: ${worktrees
          .map((w) => w.path)
          .join(", ")}`}
      >
        <FolderGit2 size={13} />
        <span>
          {worktrees.length === 1
            ? folderName(latest.path)
            : `${worktrees.length} worktrees`}
        </span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          side="top"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup
            className="composer-select-popup worktree-menu"
            aria-label="Worktrees the agent made"
          >
            <div className="composer-menu-label agent-worktree-note">
              Started in the current checkout. The agent made{" "}
              {worktrees.length === 1 ? "this worktree" : "these worktrees"}{" "}
              itself; edits there aren't in the checkout until it merges them.
            </div>
            {worktrees.map((w) => (
              <Menu.Item
                key={w.path}
                className="composer-select-item worktree-item agent-worktree-item"
                title="Open in Finder"
                onClick={() => onReveal(w.path)}
              >
                <FolderGit2 size={14} />
                <span>
                  <span>{folderName(w.path)}</span>
                  <small>
                    {w.branch ? `${w.branch} · ` : ""}
                    {w.path}
                  </small>
                </span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** After the first message a thread's place is fixed; this is how a worktree lands. */
export function WorktreeMenu({
  status,
  running,
  busy,
  onMerge,
  onCreatePr,
  onViewPr,
  onShowChanges,
  onReveal,
  onRemove,
}: {
  status?: WorktreeStatus;
  running: boolean;
  busy: boolean;
  onMerge: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
  onShowChanges: () => void;
  onReveal: () => void;
  onRemove: () => void;
}) {
  if (!status?.path || status.removed)
    return (
      <span
        className="composer-branch-trigger workspace-trigger static"
        title={
          status?.removed
            ? "The next message makes a new worktree from the checkout"
            : "Made with the first message"
        }
      >
        <FolderGit2 size={13} />
        <span>{status?.removed ? "Worktree removed" : "Worktree"}</span>
      </span>
    );
  const files = status.files.length;
  const idle = !running && !busy;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger"
        title={status.path}
      >
        <FolderGit2 size={13} />
        <span>Worktree</span>
        {status.landed && !files ? (
          <Check
            size={12}
            className="worktree-landed-mark"
            aria-label="Merged"
          />
        ) : (
          files > 0 &&
          !running && (
            <i
              className="worktree-dot"
              aria-label={`${files} ${files === 1 ? "file" : "files"} not in the checkout`}
            />
          )
        )}
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          side="top"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup
            className="composer-select-popup worktree-menu"
            aria-label="Worktree"
          >
            <div className="composer-menu-label worktree-menu-heading">
              <span>{status.branch}</span>
              <small>
                {running
                  ? "working"
                  : files
                    ? `${files} ${files === 1 ? "file" : "files"} changed`
                    : status.landed
                      ? "merged"
                      : "no changes"}
              </small>
            </div>
            <Menu.Item
              className="composer-select-item worktree-item"
              disabled={!idle || !files}
              onClick={onMerge}
            >
              <GitMerge size={14} /> Merge into current checkout
            </Menu.Item>
            {status.pr ? (
              <Menu.Item
                className="composer-select-item worktree-item"
                onClick={onViewPr}
              >
                <GitPullRequest size={14} /> View PR #{status.pr.number}
              </Menu.Item>
            ) : (
              <Menu.Item
                className="composer-select-item worktree-item"
                disabled={!idle || !files}
                onClick={onCreatePr}
              >
                <GitPullRequest size={14} /> Create PR
              </Menu.Item>
            )}
            <Menu.Separator className="composer-menu-separator" />
            <Menu.Item
              className="composer-select-item worktree-item"
              disabled={!files}
              onClick={onShowChanges}
            >
              Show changes
            </Menu.Item>
            <Menu.Item
              className="composer-select-item worktree-item"
              onClick={onReveal}
            >
              Open in Finder
            </Menu.Item>
            <Menu.Separator className="composer-menu-separator" />
            <Menu.Item
              className="composer-select-item worktree-item"
              disabled={!idle}
              onClick={onRemove}
            >
              Remove worktree
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const listFiles = (files: string[]) => {
  const names = files.slice(0, 2).map((f) => f.split("/").pop());
  return files.length > 2
    ? `${names.join(", ")} and ${files.length - 2} more`
    : names.join(" and ");
};

/** Merging stopped: files the checkout changed too. Nothing was written. */
export function WorktreeConflict({
  files,
  busy,
  onDismiss,
  onFix,
}: {
  files: string[];
  busy: boolean;
  onDismiss: () => void;
  onFix: () => void;
}) {
  return (
    <div className="waiting-strip stopped" role="status">
      <div className="waiting-strip-head">
        <TriangleAlert size={15} />
        <span className="waiting-strip-text" title={files.join("\n")}>
          <b>Couldn’t merge</b>
          <span> · {listFiles(files)} changed in the checkout too</span>
        </span>
        <button type="button" disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={onFix}
        >
          Ask the agent to fix
        </button>
      </div>
    </div>
  );
}

/** The quiet line under the thread once its worktree's changes reached the checkout. */
export function WorktreeLanded({ status }: { status: WorktreeStatus }) {
  const landed = status.landed;
  if (!landed || status.files.length) return null;
  return (
    <p className="worktree-landed">
      <Check size={12} />
      {landed.by === "relay"
        ? "Merged into the checkout"
        : landed.by === "pr"
          ? `Merged through PR #${status.pr?.number}`
          : "Merged into the checkout outside Relay"}
      {status.removed ? " · worktree removed" : ""}
    </p>
  );
}

export function RemoveWorktreeDialog({
  files,
  onCancel,
  onRemove,
}: {
  files: number;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <Modal title="Remove the worktree?" onClose={onCancel}>
      <p>
        {files} {files === 1 ? "file has" : "files have"} changes that aren’t in
        the checkout. Relay keeps a snapshot, but the worktree’s folder and
        branch go away.
      </p>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Keep it
        </button>
        <button type="button" className="danger" onClick={onRemove}>
          Remove worktree
        </button>
      </div>
    </Modal>
  );
}
