import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { SquarePen, Undo2 } from "lucide-react";
import type { TurnFileChange } from "../../shared/projects";
import { api } from "../lib/api";
import { compactCount } from "../lib/turn-diff-tree";
import { PaneResizer } from "./PaneResizer";
import { SplitDiffToggle, useSplitDiff, WorkingDiff } from "./WorkingDiff";
import { ErrorBox, FileEntryIcon, IconButton, Loading } from "./ui";
import type { PaneSlots } from "./WorkspacePanes";
import "./changed-files.css";

export type TurnDiffTarget = {
  chatId: string;
  messageId: string;
  files: TurnFileChange[];
  path?: string;
  /** Who answered and when, e.g. "Claude · 12:04". */
  label: string;
  /** Everything the thread's worktree changed that the checkout doesn't have yet. */
  worktree?: boolean;
};

const turnSides = { deletions: "Before turn", additions: "After turn" };
const worktreeSides = { deletions: "Checkout", additions: "Worktree" };

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
  const [split, setSplit] = useSplitDiff();
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
        <aside className="working-sidebar">
          <PaneResizer
            pane="changes"
            label="Resize changed files"
            initial={250}
            min={200}
            max={600}
          />
          <div className="working-file-list">
            <section>
              <header>
                <strong>
                  {target.worktree
                    ? "Changed in this worktree"
                    : "Changed in this turn"}{" "}
                  <span>{target.files.length}</span>
                </strong>
              </header>
              {target.files.map((f) => (
                <div
                  className={`working-file ${f.path === path ? "selected" : ""}`}
                  key={f.path}
                >
                  <button
                    className={`working-select turn-file${f.unclaimed ? " unclaimed" : ""}`}
                    title={
                      f.changedBy
                        ? `${f.path} · changed in thread “${f.changedBy.title}”`
                        : f.unclaimed
                          ? `${f.path} · changed outside this thread`
                          : f.path
                    }
                    onClick={() => setPath(f.path)}
                  >
                    <FileEntryIcon path={f.path} directory={false} />
                    <span>{f.path}</span>
                    {!f.binary && (
                      <span className="diff-stat">
                        <span className="diff-stat-add">
                          +{compactCount(f.additions)}
                        </span>
                        <span className="diff-stat-del">
                          −{compactCount(f.deletions)}
                        </span>
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </section>
          </div>
        </aside>
        <div className="working-review">
          {path ? (
            <>
              <header>
                <strong title={path}>{path}</strong>
                <span>
                  {sides.deletions} → {sides.additions}
                </span>
                <SplitDiffToggle split={split} onChange={setSplit} />
                <IconButton
                  label="Open in editor"
                  onClick={() => onOpenFile(path)}
                >
                  <SquarePen size={14} />
                </IconButton>
              </header>
              {diff.error ? (
                <ErrorBox error={diff.error} />
              ) : diff.data ? (
                <WorkingDiff
                  pair={diff.data}
                  sideLabels={sides}
                  split={split}
                />
              ) : (
                <Loading text="Loading turn diff…" />
              )}
            </>
          ) : (
            <div className="empty">
              <h2>
                {target.worktree
                  ? "Nothing here that the checkout doesn’t have."
                  : "This turn changed no files."}
              </h2>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
