import type { ReactElement } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Copy,
  EyeOff,
  FileDiff,
  FolderOpen,
  Minus,
  Plus,
  SquarePen,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ChangeArea, WorkingChange } from "../../shared/working-tree";
import { api } from "../lib/api";
import { otherArea } from "../lib/working-changes";
import { ContextMenuItem } from "./ContextMenuItem";
import { revealLabel } from "./FileTree";

/** Right-click actions for one row of the local changes list. */
export function LocalChangeMenu({
  change,
  area,
  projectId,
  busy,
  trigger,
  onStage,
  onIgnore,
  onDiscard,
  onShowArea,
  onOpenFile,
  onTrashed,
  onError,
}: {
  change: WorkingChange;
  area: ChangeArea;
  /** Finder, absolute paths and Trash need a project folder, not a PR checkout. */
  projectId?: string;
  busy: boolean;
  trigger: ReactElement;
  onStage: () => void;
  onIgnore: (file: "gitignore" | "exclude") => void;
  /** Throws away the change; a copy of the file goes to the Trash first. */
  onDiscard: () => void;
  onShowArea: (area: ChangeArea) => void;
  onOpenFile?: (path: string) => void;
  onTrashed: () => void;
  onError: (error: unknown) => void;
}) {
  const path = change.path,
    onDisk = change.worktree !== "D",
    untracked = change.index === "?",
    // A partly staged file has a diff on both sides of the index.
    other = otherArea(change, area);
  const run = (work: () => Promise<unknown>) => void work().catch(onError);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={trigger} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="sb-menu-positioner">
          <ContextMenu.Popup className="sb-menu">
            <ContextMenuItem
              icon={
                area === "staged" ? <Minus size={13} /> : <Plus size={13} />
              }
              disabled={busy}
              onClick={onStage}
            >
              {area === "staged" ? "Unstage" : "Stage"}
            </ContextMenuItem>
            {other && (
              <ContextMenuItem
                icon={<FileDiff size={13} />}
                onClick={() => onShowArea(other)}
              >
                {other === "staged"
                  ? "Show staged changes"
                  : "Show working changes"}
              </ContextMenuItem>
            )}
            <ContextMenu.Separator className="sb-menu-separator" />
            {onOpenFile && (
              <ContextMenuItem
                icon={<SquarePen size={13} />}
                disabled={!onDisk}
                onClick={() => onOpenFile(path)}
              >
                Open in editor
              </ContextMenuItem>
            )}
            {projectId && (
              <ContextMenuItem
                icon={<FolderOpen size={13} />}
                disabled={!onDisk}
                onClick={() =>
                  run(() => api.revealProjectPath(projectId, path))
                }
              >
                {revealLabel}
              </ContextMenuItem>
            )}
            {projectId && (
              <ContextMenuItem
                icon={<Copy size={13} />}
                onClick={() =>
                  run(async () =>
                    api.writeClipboard(
                      await api.projectAbsolutePath(projectId, path),
                    ),
                  )
                }
              >
                Copy path
              </ContextMenuItem>
            )}
            <ContextMenuItem
              icon={<Copy size={13} />}
              onClick={() => run(() => api.writeClipboard(path))}
            >
              Copy relative path
            </ContextMenuItem>
            {untracked && (
              <>
                <ContextMenu.Separator className="sb-menu-separator" />
                <ContextMenuItem
                  icon={<EyeOff size={13} />}
                  disabled={busy}
                  onClick={() => onIgnore("gitignore")}
                >
                  Add to .gitignore
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<EyeOff size={13} />}
                  disabled={busy}
                  onClick={() => onIgnore("exclude")}
                >
                  Add to .git/info/exclude
                </ContextMenuItem>
              </>
            )}
            {untracked ? (
              projectId && (
                <>
                  <ContextMenu.Separator className="sb-menu-separator" />
                  <ContextMenuItem
                    icon={<Trash2 size={13} />}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.trashProjectEntry(projectId, path);
                        onTrashed();
                      })
                    }
                  >
                    Move to Trash
                  </ContextMenuItem>
                </>
              )
            ) : (
              <>
                <ContextMenu.Separator className="sb-menu-separator" />
                <ContextMenuItem
                  icon={<Undo2 size={13} />}
                  disabled={busy || change.conflict}
                  onClick={onDiscard}
                >
                  {area === "staged" ? "Revert to HEAD" : "Discard changes"}
                </ContextMenuItem>
              </>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
