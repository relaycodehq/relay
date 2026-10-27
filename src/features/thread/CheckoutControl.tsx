import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Folder, FolderGit2, FolderX } from "lucide-react";
import type {
  ActiveAgentWorktree,
  AgentWorktree,
  WorkspaceMove,
} from "../../../shared/projects";
import { agentWorktreeKey } from "../../../shared/projects";
import { fileManager } from "../../lib/mod-key";
import { MovedDot, MovedNote } from "./WorkspaceMoved";
import "../changes/worktrees.css";
import "../changes/branch-picker.css";

export const folderName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * A checkout thread with a worktree its agent made with git on its own:
 * that's where its edits go, so the footer has to say so. Without one there
 * is nothing to choose; moving the thread out is in its right-click menu.
 */
export function CheckoutControl({
  worktrees = [],
  active,
  recreatable = false,
  onRecreate,
  onSelect,
  selectionDisabled = false,
  onReveal,
  moved,
  onSeen,
}: {
  worktrees?: AgentWorktree[];
  active?: ActiveAgentWorktree;
  /** The deleted worktree's branch is still there to make it again from. */
  recreatable?: boolean;
  onRecreate?: () => void;
  onSelect?: (path: string | null) => void;
  selectionDisabled?: boolean;
  onReveal: (path: string) => void;
  /** Where it works changed without the user, and they haven't opened this since. */
  moved?: WorkspaceMove;
  onSeen?: () => void;
}) {
  if (!worktrees.length && !active) return null;
  const selected =
    active &&
    worktrees.find((w) => agentWorktreeKey(w) === agentWorktreeKey(active));
  const disabled = selectionDisabled || !onSelect;
  if (active && !selected)
    return (
      <DeletedWorktree
        name={folderName(active.path)}
        disabled={disabled}
        onRecreate={recreatable ? onRecreate : undefined}
        onCheckout={() => onSelect?.(null)}
      />
    );
  const Icon = active ? FolderGit2 : Folder;
  return (
    <Menu.Root onOpenChange={(open) => !open && onSeen?.()}>
      <Menu.Trigger
        className="composer-branch-trigger workspace-trigger agent-worktree-trigger"
        title={
          active
            ? `Active workspace: ${selected?.path ?? active.path}`
            : "Active workspace: current checkout. Select a worktree here to use it."
        }
      >
        <Icon size={13} />
        <span>{selected ? folderName(selected.path) : "Current checkout"}</span>
        {moved && <MovedDot />}
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
            {moved && <MovedNote move={moved} />}
            <div className="composer-menu-label agent-worktree-note">
              Choose where Git, files and future agent turns work. This choice
              stays until you change it.
            </div>
            <Menu.RadioGroup
              value={selected?.path ?? "checkout"}
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
                <span className="agent-worktree-label">Current checkout</span>
                <Menu.RadioItemIndicator className="agent-worktree-selected">
                  <Check size={13} />
                </Menu.RadioItemIndicator>
              </Menu.RadioItem>
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
                  Open active worktree in {fileManager}
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
 * The worktree a thread worked in was deleted under it. Nothing runs until
 * the user picks where it carries on, so the row says so in red and offers
 * both ways right there.
 */
function DeletedWorktree({
  name,
  disabled,
  onRecreate,
  onCheckout,
}: {
  name: string;
  disabled: boolean;
  /** Absent once its branch went with it. */
  onRecreate?: () => void;
  onCheckout: () => void;
}) {
  return (
    <>
      <span
        className="composer-branch-trigger workspace-trigger static deleted-worktree"
        role="alert"
        title={`This thread worked in ${name}, which was deleted. Pick where it carries on.`}
      >
        <FolderX size={13} />
        <span>Worktree deleted</span>
      </span>
      {onRecreate && (
        <button
          type="button"
          className="deleted-worktree-action"
          disabled={disabled}
          title={`Make ${name} again from its branch`}
          onClick={onRecreate}
        >
          Recreate worktree
        </button>
      )}
      <button
        type="button"
        className="deleted-worktree-action checkout"
        disabled={disabled}
        title="Work in the project folder from now on"
        onClick={onCheckout}
      >
        Continue in checkout
      </button>
    </>
  );
}
