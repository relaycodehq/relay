import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Folder, FolderGit2 } from "lucide-react";
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
  checkout: { label: "Project folder", icon: Folder },
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
  onMove,
}: {
  worktrees?: AgentWorktree[];
  onReveal: (path: string) => void;
  /** Moves the thread into a worktree of its own; unset where it can't. */
  onMove?: () => void;
}) {
  const move = onMove && (
    <Menu.Item className="composer-select-item worktree-item" onClick={onMove}>
      <FolderGit2 size={14} />
      Move into its own worktree…
    </Menu.Item>
  );
  if (!worktrees.length)
    return (
      <Menu.Root>
        <Menu.Trigger
          className={`composer-branch-trigger workspace-trigger${move ? "" : " static"}`}
          disabled={!move}
          title="Edits go straight into the project folder, alongside any other thread working there"
        >
          <Folder size={13} />
          <span>Project folder</span>
          {move && <ChevronDown size={12} />}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className="composer-popup-positioner"
            side="top"
            align="end"
            sideOffset={6}
          >
            <Menu.Popup
              className="composer-select-popup worktree-menu"
              aria-label="Workspace"
            >
              {move}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  const [latest] = worktrees.slice(-1);
  return (
    <Menu.Root>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger agent-worktree-trigger"
        title={`The agent made ${worktrees.length === 1 ? "a worktree" : "worktrees"} outside the project folder: ${worktrees
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
              Started in the project folder. The agent made{" "}
              {worktrees.length === 1 ? "this worktree" : "these worktrees"}{" "}
              itself; edits there aren't in the project folder until it merges
              them.
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
            {move && <Menu.Separator className="composer-menu-separator" />}
            {move}
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
          status?.removed
            ? "The next message makes a new worktree from the project folder"
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

export function RemoveWorktreeDialog({
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
