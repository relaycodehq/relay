import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Copy, Folder, FolderGit2 } from "lucide-react";
import type {
  ChatSummary,
  ChatWorkspace,
  ChatWorktree,
  WorkspaceMove,
  WorktreeStatus,
} from "../../../shared/projects";
import { tildePath } from "../../../shared/projects";
import { unseenWorkspaceMove } from "../../../shared/workspace-moves";
import {
  markWorkspaceMoveSeen,
  useWorkspaceMoveSeen,
} from "./workspace-move-seen";
import { api } from "../../lib/api";
import { worktreeDiff, type TurnDiffTarget } from "../changes/turn-diff";
import type { ThreadWorktree } from "./useThreadWorktree";
import type { MessageNote } from "./MessageNotes";
import { Modal, Spinner } from "../../ui/ui";
import "../changes/worktrees.css";
import "../changes/branch-picker.css";
import { fileManager } from "../../lib/mod-key";
import { useCopy } from "../../lib/useCopy";
import { CheckoutControl, folderName } from "./CheckoutControl";
import { MovedDot, MovedNote } from "./WorkspaceMoved";

/** The composer's workspace slot: where an unsent thread will work, then where it does. */
export function WorkspaceControl({
  chat,
  worktree,
  running,
  busy,
  named = false,
  onOpenTurnDiff,
  onError,
}: {
  chat?: ChatSummary;
  worktree: ThreadWorktree;
  running: boolean;
  /** Sending; the picker waits for it. */
  busy: boolean;
  /** Names the worktree by its folder, where there's room to, instead of "Worktree". */
  named?: boolean;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  onError: (error: unknown) => void;
}) {
  const seenAt = useWorkspaceMoveSeen(chat?.id ?? "");
  if (!chat)
    return (
      <WorkspacePicker
        value={worktree.workspace}
        onChange={worktree.setWorkspace}
        disabled={busy}
      />
    );
  const moved = unseenWorkspaceMove(chat, seenAt);
  const onSeen = moved && (() => markWorkspaceMoveSeen(chat.id, moved.at));
  if (!chat.worktree)
    return (
      <CheckoutControl
        moved={moved}
        onSeen={onSeen}
        worktrees={chat.agentWorktrees}
        active={chat.activeAgentWorktree}
        recreatable={worktree.recreatable}
        onRecreate={() => void worktree.recreate()}
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
      named={named}
      moved={moved}
      onSeen={onSeen}
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
        existing={!!worktree.status?.existing}
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
  checkout: { label: "Current checkout", icon: Folder },
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

/** Why a worktree thread has no worktree on disk right now, and what the next message does. */
function worktreeGoneTitle(status: WorktreeStatus | undefined) {
  const branch = status?.branch ?? "Its branch";
  if (status?.cleanedUp)
    return `Removed a while after the thread settled. ${branch} stays; the next message checks it out in a worktree again`;
  if (status?.removed && status.existing)
    return `${branch} stays; the next message checks it out in a worktree again`;
  if (status?.removed)
    return "The next message makes a new worktree from the project folder";
  return "Made with the first message";
}

/**
 * After the first message a thread's place is fixed. Its worktree is an
 * ordinary branch: the header's Git button commits, pushes and lands it.
 */
export function WorktreeMenu({
  status,
  named = false,
  moved,
  onSeen,
  running,
  busy,
  onShowChanges,
  onReveal,
  onRemove,
}: {
  status?: WorktreeStatus;
  named?: boolean;
  /** It moved or was made again without the user, and they haven't opened this since. */
  moved?: WorkspaceMove;
  onSeen?: () => void;
  running: boolean;
  busy: boolean;
  /** Everything the branch has that `from` doesn't, committed or not. */
  onShowChanges: () => void;
  onReveal: () => void;
  onRemove: () => void;
}) {
  if (status?.naming)
    return (
      <span
        className="composer-branch-trigger workspace-trigger static"
        title="Naming the worktree after the thread's title; the agent starts once it has"
      >
        <FolderGit2 size={13} />
        <span>Worktree</span>
        <Spinner size={11} steady />
      </span>
    );
  if (!status?.path || status.removed)
    return (
      <span
        className="composer-branch-trigger workspace-trigger static"
        title={worktreeGoneTitle(status)}
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
    <Menu.Root onOpenChange={(open) => !open && onSeen?.()}>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger"
        title={status.path}
      >
        <FolderGit2 size={13} />
        <span>{named ? folderName(status.path) : "Worktree"}</span>
        {moved ? (
          <MovedDot />
        ) : (
          status.landed &&
          !files && (
            <Check
              size={12}
              className="worktree-landed-mark"
              aria-label="Merged"
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
            <WorktreePath path={status.path} />
            {moved && <MovedNote move={moved} />}
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
              Open in {fileManager}
            </Menu.Item>
            {/* A folder Relay didn't make is the user's to remove. */}
            {!status.adopted && (
              <>
                <Menu.Separator className="composer-menu-separator" />
                <Menu.Item
                  className="composer-select-item worktree-item"
                  disabled={!idle}
                  onClick={onRemove}
                >
                  Remove worktree
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Shown short, copied whole: the agent's own messages name the absolute path. */
function WorktreePath({ path }: { path: string }) {
  const [copied, copy] = useCopy();
  return (
    <Menu.Item
      className="composer-select-item worktree-item worktree-path"
      closeOnClick={false}
      title={`Copy ${path}`}
      onClick={() => copy(path)}
    >
      <span>{tildePath(path)}</span>
      {copied ? (
        <Check size={12} aria-label="Copied" />
      ) : (
        <Copy size={12} aria-hidden />
      )}
    </Menu.Item>
  );
}

/** The note once the worktree's branch landed, with nothing left to merge. */
export function landedNote(status: WorktreeStatus): MessageNote | undefined {
  const landed = status.landed;
  if (!landed || status.files.length) return undefined;
  const how =
    landed.by === "pr"
      ? `Merged through PR #${status.pr?.number}`
      : `Merged into ${status.from ?? "its source branch"}`;
  return {
    key: "worktree-landed",
    text: `${how}${status.removed ? " · worktree removed" : ""}`,
    landed: true,
  };
}

/** The note when the branch named or picked for the thread couldn't be used by the time it sent. */
export function renamedNote(worktree: ChatWorktree): MessageNote | undefined {
  const { wanted, branch } = worktree;
  if (!wanted || !branch) return undefined;
  return {
    key: "worktree-renamed",
    text: wanted.off
      ? `Its worktree is on ${branch} off the project folder's commit, not off ${wanted.branch}: ${wanted.problem}`
      : `Its worktree is on ${branch}, not ${wanted.branch}: ${wanted.problem}`,
  };
}

function RemoveWorktreeDialog({
  files,
  from,
  existing,
  onCancel,
  onRemove,
}: {
  files: number;
  from?: string;
  /** It carries on a branch from before the thread, which stays. */
  existing: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <Modal title="Remove the worktree?" onClose={onCancel}>
      <p>
        {files} {files === 1 ? "file has" : "files have"} changes that aren’t in{" "}
        {from ?? "the project folder’s branch"}.{" "}
        {existing
          ? "The branch stays with its commits, but what isn’t committed goes with the worktree’s folder, kept only in Relay’s snapshot."
          : "Relay keeps a snapshot, but the worktree’s folder and branch go away."}
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
