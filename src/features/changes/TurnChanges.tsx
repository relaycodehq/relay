import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ContextMenu } from "@base-ui/react/context-menu";
import { FolderOpen, Undo2 } from "lucide-react";
import { api } from "../../lib/api";
import type { TurnDiffTarget } from "./turn-diff";
import { DiffStatLabel } from "./DiffStatLabel";
import { ChangesReview, ChangesSidebar } from "./ChangesPane";
import { ErrorBox, FileEntryIcon } from "../../ui/ui";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import type { PaneSlots } from "../../ui/WorkspacePanes";
import "./changed-files.css";

const turnSides = { deletions: "Before turn", additions: "After turn" };
const worktreeSides = { deletions: "Branched from", additions: "Worktree" };

/** What one agent turn changed, from the snapshots Relay took around it. */
export function TurnChanges({
  target,
  slots,
  onClose,
  onOpenFile,
}: {
  target: TurnDiffTarget;
  slots: PaneSlots;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [path, setPath] = useState(target.path ?? target.files[0]?.path);
  const [revealError, setRevealError] = useState<string>();
  const sides = target.worktree ? worktreeSides : turnSides;
  const diff = useQuery({
    queryKey: target.worktree
      ? ["worktree-diff", target.chatId, path]
      : ["turn-diff", target.chatId, target.messageId, path],
    queryFn: () =>
      target.worktree
        ? api.projectWorktreeDiff(target.chatId, path!)
        : api.projectTurnDiff(target.chatId, target.messageId, path!),
    enabled: !!path,
    // Snapshots never change, so a turn's diff stays valid for the session.
    staleTime: target.worktree ? 0 : Infinity,
  });
  return (
    <section className="local-changes" aria-label="Turn changes">
      {slots.title &&
        createPortal(
          <span className="pane-chip">{target.label}</span>,
          slots.title,
        )}
      {slots.actions &&
        createPortal(
          <button onClick={onClose}>
            <Undo2 size={15} />
            Local changes
          </button>,
          slots.actions,
        )}
      <div className="working-content">
        <ChangesSidebar
          title={
            target.worktree
              ? "Changed in this worktree"
              : "Changed in this turn"
          }
          count={target.files.length}
        >
          {target.files.map((f) => (
            <ContextMenu.Root key={f.path}>
              <ContextMenu.Trigger
                render={
                  <div
                    className={`working-file ${f.path === path ? "selected" : ""}`}
                  />
                }
              >
                <button
                  className="working-select turn-file"
                  title={f.path}
                  onClick={() => setPath(f.path)}
                >
                  <FileEntryIcon path={f.path} directory={false} />
                  <MiddleTruncate text={f.path} kind="path" title={null} />
                  {!f.binary && <DiffStatLabel stat={f} />}
                </button>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner className="sb-menu-positioner">
                  <ContextMenu.Popup className="sb-menu">
                    <ContextMenu.Item
                      className="sb-menu-item"
                      onClick={() =>
                        void api
                          .revealProjectTurnFile(
                            target.chatId,
                            target.worktree ? null : target.messageId,
                            f.path,
                          )
                          .catch((e) =>
                            setRevealError(
                              e instanceof Error ? e.message : String(e),
                            ),
                          )
                      }
                    >
                      <span className="sb-menu-label">
                        <FolderOpen size={13} />
                        Show in Finder
                      </span>
                    </ContextMenu.Item>
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
          {revealError && <ErrorBox error={new Error(revealError)} />}
        </ChangesSidebar>
        <ChangesReview
          path={path}
          sides={sides}
          diff={diff}
          loading="Loading turn diff…"
          empty={
            target.worktree
              ? "Nothing here that the checkout doesn’t have."
              : "This turn changed no files."
          }
          onOpenFile={onOpenFile}
        />
      </div>
    </section>
  );
}
