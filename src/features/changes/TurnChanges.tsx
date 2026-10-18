import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Undo2 } from "lucide-react";
import { api } from "../../lib/api";
import type { TurnDiffTarget } from "./turn-diff";
import { ChangesReview, ChangesSidebar } from "./ChangesPane";
import { TurnFileList } from "./TurnFileList";
import { ListViewToggle } from "./ListViewToggle";
import { useSavedChanges } from "./useSavedChanges";
import { ErrorBox, IconButton } from "../../ui/ui";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import type { PaneSlots } from "../../ui/WorkspacePanes";
import "./changed-files.css";
import "./working-tree.css";

const turnSides = { deletions: "Before turn", additions: "After turn" };
const worktreeSides = { deletions: "Branched from", additions: "Worktree" };

/** What one agent turn changed, from the snapshots Relay took around it. */
export function TurnChanges({
  target,
  workspace,
  slots,
  onClose,
  onOpenFile,
}: {
  target: TurnDiffTarget;
  /** Whose local changes list this one shares its folder grouping with. */
  workspace?: string;
  slots: PaneSlots;
  /** Back to the local changes; absent where a switch in the title does that. */
  onClose?: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [picked, setPath] = useState(target.path ?? target.files[0]?.path);
  // A worktree's list is live: a file that appears is picked once there is one,
  // and one that's gone gives way to the first.
  const path =
    target.worktree && !target.files.some((f) => f.path === picked)
      ? target.files[0]?.path
      : picked;
  const [revealError, setRevealError] = useState<string>();
  const { grouped, setGrouped } = useSavedChanges(workspace);
  const qc = useQueryClient();
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
  const reveal = (file: string) =>
    void api
      .revealProjectTurnFile(
        target.chatId,
        target.worktree ? null : target.messageId,
        file,
      )
      .catch((e) => setRevealError(e instanceof Error ? e.message : String(e)));
  return (
    <section className="local-changes" aria-label="Turn changes">
      {slots.title &&
        createPortal(
          <span className="pane-chip">
            <MiddleTruncate text={target.label} kind="branch" />
          </span>,
          slots.title,
        )}
      {slots.actions &&
        createPortal(
          <>
            {target.worktree && (
              <IconButton
                label="Refresh worktree changes"
                onClick={() => {
                  void qc.invalidateQueries({
                    queryKey: ["worktree", target.chatId],
                  });
                  void diff.refetch();
                }}
              >
                <RefreshCw size={15} />
              </IconButton>
            )}
            {onClose && (
              <button onClick={onClose}>
                <Undo2 size={15} />
                Local changes
              </button>
            )}
          </>,
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
          tools={<ListViewToggle grouped={grouped} onGrouped={setGrouped} />}
        >
          <TurnFileList
            files={target.files}
            selected={path}
            grouped={grouped}
            onPick={setPath}
            onReveal={reveal}
          />
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
          onReveal={reveal}
        />
      </div>
    </section>
  );
}
