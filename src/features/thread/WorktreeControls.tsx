import { Menu } from "@base-ui/react/menu";
import {
  Check,
  ChevronDown,
  Folder,
  FolderGit2,
  GitBranch,
} from "lucide-react";
import type {
  AgentWorktree,
  ActiveAgentWorktree,
  ChatSummary,
  ChatWorkspace,
  ChatWorktree,
  WorktreeStatus,
} from "../../../shared/projects";
import { agentWorktreeKey } from "../../../shared/projects";
import { api } from "../../lib/api";
import { worktreeDiff, type TurnDiffTarget } from "../changes/turn-diff";
import type { ThreadWorktree } from "./useThreadWorktree";
import { Modal } from "../../ui/ui";
import "../changes/worktrees.css";
import "../changes/branch-picker.css";

/** The composer's workspace slot: where an unsent thread will work, then where it does. */
export function WorkspaceControl({
  chat,
  worktree,
  running,
  busy,
  onOpenTurnDiff,
  onError,
}: {
  chat?: ChatSummary;
  worktree: ThreadWorktree;
  running: boolean;
  /** Sending; the picker waits for it. */
  busy: boolean;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  onError: (error: unknown) => void;
}) {
  if (!chat)
    return (
      <WorkspacePicker
        value={worktree.workspace}
        onChange={worktree.setWorkspace}
        disabled={busy}
      />
    );
  if (!chat.worktree)
    return (
      <CheckoutControl
        worktrees={chat.agentWorktrees}
        active={chat.activeAgentWorktree}
        onSelect={(path) => void worktree.select(path)}
        selectionDisabled={busy || worktree.selectionDisabled}
        onReveal={(path) =>
          void api.revealAgentWorktree(chat.id, path).catch(onError)
        }
      />
    );
  const { status } = worktree;
  return (
    <WorktreeMenu
      status={status}
      running={running}
      busy={worktree.busy}
      onShowChanges={() => {
        if (status?.files.length) onOpenTurnDiff(worktreeDiff(chat.id, status));
      }}
      onReveal={() => void api.revealProjectWorktree(chat.id).catch(onError)}
      onRemove={() => {
        if (status?.files.length) worktree.setDialog("remove");
        else void worktree.remove();
      }}
    />
  );
}

/** Kept out of the composer, which remounts with each side conversation: a dialog in it would start over. */
export function WorktreeDialogs({
  chat,
  worktree,
}: {
  chat?: ChatSummary;
  worktree: ThreadWorktree;
}) {
  const close = () => worktree.setDialog(undefined);
  if (chat && worktree.dialog === "remove")
    return (
      <RemoveWorktreeDialog
        files={worktree.status?.files.length ?? 0}
        from={worktree.status?.from}
        onCancel={close}
        onRemove={() => {
          close();
          void worktree.remove();
        }}
      />
    );
  return null;
}

const workspaces: Record<
  ChatWorkspace,
  { label: string; icon: typeof Folder }
> = {
  checkout: { label: "Project folder", icon: Folder },
  worktree: { label: "New worktree", icon: FolderGit2 },
};

/** Before a thread's first message: where it will work. */
function WorkspacePicker({
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
 * A checkout thread with a worktree its agent made with git on its own:
 * that's where its edits go, so the footer has to say so. Without one there
 * is nothing to choose; moving the thread out is in its right-click menu.
 */
export function CheckoutControl({
  worktrees = [],
  active,
  onSelect,
  selectionDisabled = false,
  onReveal,
}: {
  worktrees?: AgentWorktree[];
  active?: ActiveAgentWorktree;
  onSelect?: (path: string | null) => void;
  selectionDisabled?: boolean;
  onReveal: (path: string) => void;
}) {
  if (!worktrees.length && !active) return null;
  const selected =
    active &&
    worktrees.find((w) => agentWorktreeKey(w) === agentWorktreeKey(active));
  const unavailable = !!active && !selected;
  const Icon = active ? FolderGit2 : Folder;
  const disabled = selectionDisabled || !onSelect;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger agent-worktree-trigger"
        title={
          active
            ? `Active workspace: ${selected?.path ?? active.path}${unavailable ? " (unavailable)" : ""}`
            : "Active workspace: project folder. Select a worktree here to use it."
        }
      >
        <Icon size={13} />
        <span>
          {unavailable
            ? "Worktree unavailable"
            : selected
              ? folderName(selected.path)
              : "Project folder"}
        </span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          side="top"
          align="end"
          sideOffset={6}
        >
          <Menu.Popup
            className="composer-select-popup worktree-menu agent-worktree-menu"
            aria-label="Active workspace"
          >
            <div className="composer-menu-label agent-worktree-note">
              {unavailable
                ? "The selected worktree is unavailable. Choose a workspace to continue."
                : "Choose where Git, files and future agent turns work. This choice stays until you change it."}
            </div>
            <Menu.RadioGroup
              value={selected?.path ?? active?.path ?? "checkout"}
              onValueChange={(value: string) =>
                onSelect?.(value === "checkout" ? null : value)
              }
            >
              <Menu.RadioItem
                value="checkout"
                disabled={disabled}
                closeOnClick
                className="composer-select-item worktree-item"
              >
                <Folder size={14} />
                <span className="agent-worktree-label">Project folder</span>
                <Menu.RadioItemIndicator className="agent-worktree-selected">
                  <Check size={13} />
                </Menu.RadioItemIndicator>
              </Menu.RadioItem>
              {unavailable && (
                <Menu.RadioItem
                  value={active!.path}
                  disabled
                  className="composer-select-item worktree-item agent-worktree-item"
                >
                  <FolderGit2 size={14} />
                  <span className="agent-worktree-label">
                    <span>{folderName(active!.path)} (unavailable)</span>
                    <small>{active!.path}</small>
                  </span>
                  <Menu.RadioItemIndicator className="agent-worktree-selected">
                    <Check size={13} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              )}
              {worktrees.map((w) => (
                <Menu.RadioItem
                  key={w.path}
                  value={w.path}
                  className="composer-select-item worktree-item agent-worktree-item"
                  title={
                    selectionDisabled
                      ? "Save your edits and wait for the agent before changing workspace"
                      : `Use ${w.path}`
                  }
                  disabled={disabled}
                  closeOnClick
                >
                  <FolderGit2 size={14} />
                  <span className="agent-worktree-label">
                    <span>{folderName(w.path)}</span>
                    <small>
                      {w.branch ? `${w.branch} · ` : ""}
                      {w.path}
                    </small>
                  </span>
                  <Menu.RadioItemIndicator className="agent-worktree-selected">
                    <Check size={13} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            {selected && (
              <>
                <Menu.Separator className="composer-menu-separator" />
                <Menu.Item
                  className="composer-select-item worktree-item"
                  onClick={() => onReveal(selected.path)}
                >
                  Open active worktree in Finder
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * After the first message a thread's place is fixed. Its worktree is an
 * ordinary branch: the header's Git button commits, pushes and lands it.
 */
export function WorktreeMenu({
  status,
  running,
  busy,
  onShowChanges,
  onReveal,
  onRemove,
}: {
  status?: WorktreeStatus;
  running: boolean;
  busy: boolean;
  /** Everything the branch has that `from` doesn't, committed or not. */
  onShowChanges: () => void;
  onReveal: () => void;
  onRemove: () => void;
}) {
  if (!status?.path || status.removed)
    return (
      <span
        className="composer-branch-trigger workspace-trigger static"
        title={
          status?.cleanedUp
            ? `Removed a while after the thread settled. ${status.branch ?? "Its branch"} stays; the next message checks it out in a worktree again`
            : status?.removed
              ? "The next message makes a new worktree from the project folder"
              : "Made with the first message"
        }
      >
        <FolderGit2 size={13} />
        <span>
          {status?.cleanedUp
            ? "Worktree cleaned up"
            : status?.removed
              ? "Worktree removed"
              : "Worktree"}
        </span>
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
              aria-label={`${files} ${files === 1 ? "file" : "files"} not in ${status.from ?? "the project folder's branch"}`}
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
                    ? `${files} ${files === 1 ? "file" : "files"} not in ${status.from ?? "its source branch"}`
                    : status.landed
                      ? `merged into ${status.from ?? "its source branch"}`
                      : "no changes"}
              </small>
            </div>
            <Menu.Item
              className="composer-select-item worktree-item"
              disabled={!files}
              onClick={onShowChanges}
            >
              Changes against {status.from ?? "its source branch"}
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

/** The quiet line under the thread once its worktree's branch landed. */
export function WorktreeLanded({ status }: { status: WorktreeStatus }) {
  const landed = status.landed;
  if (!landed || status.files.length) return null;
  return (
    <p className="worktree-landed">
      <Check size={12} />
      {landed.by === "pr"
        ? `Merged through PR #${status.pr?.number}`
        : `Merged into ${status.from ?? "its source branch"}`}
      {status.removed ? " · worktree removed" : ""}
    </p>
  );
}

/** The quiet line under a thread's first message when the branch named for it was taken by the time it sent. */
export function WorktreeRenamed({ worktree }: { worktree: ChatWorktree }) {
  const { wanted, branch } = worktree;
  if (!wanted || !branch) return null;
  return (
    <p className="worktree-landed worktree-renamed">
      <GitBranch size={12} />
      Its worktree is on {branch}, not {wanted.branch}: {wanted.problem}
    </p>
  );
}

function RemoveWorktreeDialog({
  files,
  from,
  onCancel,
  onRemove,
}: {
  files: number;
  from?: string;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <Modal title="Remove the worktree?" onClose={onCancel}>
      <p>
        {files} {files === 1 ? "file has" : "files have"} changes that aren’t in{" "}
        {from ?? "the project folder’s branch"}. Relay keeps a snapshot, but the
        worktree’s folder and branch go away.
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
