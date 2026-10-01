import { useEffect, useRef, useState } from "react";
import type { Pull } from "../../shared/types";
import type { ChangeArea } from "../../shared/working-tree";
import type { CodeReference } from "../../shared/code-references";
import type { ProjectFileLink } from "../../shared/project-file-links";
import { api } from "../lib/api";
import type { RequestChannel } from "../lib/request-channel";
import { changeSections, commitBlocked } from "../lib/working-changes";
import { useSavedChanges } from "../lib/useSavedChanges";
import { useWorkingDiff, useWorkingTree } from "../lib/useWorkingTree";
import { useChangeReveals } from "../lib/useChangeReveals";
import { ChangesToolbar } from "./local-changes/ChangesToolbar";
import { ErrorBox, Loading } from "./ui";
import { PaneResizer } from "./PaneResizer";
import { CommitSplitSheet } from "./CommitSplit";
import { ChangeList } from "./local-changes/ChangeList";
import { CommitForm } from "./local-changes/CommitForm";
import { ChangeReview } from "./local-changes/ChangeReview";
import { PushDialog } from "./local-changes/PushDialog";
import { useSplitDiff } from "./WorkingDiff";
import type { PaneSlots } from "./WorkspacePanes";
import "./working-tree.css";

export function LocalChanges({
  pull,
  projectId,
  onSelection,
  slots,
  onOpenFile,
  onAsk,
  reveals,
}: {
  pull?: Pull;
  projectId?: string;
  onSelection?: (path: string | null) => void;
  /** When hosted in a workspace pane, the toolbar lives in the pane header. */
  slots?: PaneSlots;
  onOpenFile?: (path: string, line?: number) => void;
  /** Attaches selected diff lines to the project chat composer. */
  onAsk?: (ref: CodeReference) => void;
  /** Files to select, such as ones clicked in the chat. */
  reveals?: RequestChannel<ProjectFileLink>;
}) {
  const [split, setSplit] = useSplitDiff();
  const { selected, setSelected, message, setMessage, grouped, setGrouped } =
    useSavedChanges(projectId);
  useEffect(() => {
    onSelection?.(selected?.path ?? null);
  }, [selected?.path]);
  const working = useWorkingTree(pull, projectId);
  const { state, tree, busy, error, notice, act } = working;
  const diff = useWorkingDiff(working, pull, projectId, selected);
  const [push, setPush] = useState(false),
    [splitting, setSplitting] = useState(false),
    [collapsed, setCollapsed] = useState<ChangeArea[]>([]);
  const fileList = useRef<HTMLDivElement>(null);
  const { missing, line, setLine, pick } = useChangeReveals({
    reveals,
    tree,
    selected,
    setSelected,
    onReveal: (area) => setCollapsed((c) => c.filter((a) => a !== area)),
    list: fileList,
  });
  const sections = tree ? changeSections(tree.changes) : [];
  return (
    <section className="local-changes" aria-label="Local changes">
      <ChangesToolbar
        slots={slots}
        pull={pull}
        tree={tree}
        busy={busy}
        grouped={grouped}
        onGrouped={setGrouped}
        onRefresh={() => void state.refetch()}
        onPush={() => setPush(true)}
      />
      {state.error && (
        <>
          <ErrorBox error={state.error} />
          {pull && (
            <button
              onClick={() =>
                void api
                  .linkFolder(pull)
                  .then(() => state.refetch())
                  .catch(working.setError)
              }
            >
              Link local folder
            </button>
          )}
        </>
      )}
      {!!error && <ErrorBox error={error} />}
      {notice && (
        <p className="working-notice" role="status">
          {notice}
        </p>
      )}
      {tree?.operation && (
        <p role="status" className="working-notice">
          Git operation in progress: {tree.operation}. Finish it in your
          terminal before committing here.
        </p>
      )}
      {state.isPending ? (
        <Loading text="Reading local changes…" />
      ) : (
        tree && (
          <div className="working-content">
            <aside className="working-sidebar">
              <PaneResizer
                pane="changes"
                label="Resize changed files"
                initial={250}
                min={200}
                max={600}
              />
              <ChangeList
                sections={sections}
                revision={tree.revision}
                selected={selected}
                grouped={grouped}
                collapsed={collapsed}
                onCollapse={(area, collapse) =>
                  setCollapsed((c) =>
                    collapse ? [...c, area] : c.filter((a) => a !== area),
                  )
                }
                busy={busy}
                projectId={projectId}
                listRef={fileList}
                onAct={(action) => void act(action)}
                onPick={pick}
                onOpenFile={onOpenFile}
                onTrashed={() => void state.refetch()}
                onError={working.setError}
              />
              <CommitForm
                message={message}
                onMessage={setMessage}
                busy={busy}
                canCommit={
                  !busy &&
                  !!message.trim() &&
                  !!sections[0]?.files.length &&
                  !commitBlocked(tree)
                }
                canSplit={
                  !busy && !!tree.changes.length && !commitBlocked(tree)
                }
                onCommit={() =>
                  void act(
                    { kind: "commit", revision: tree.revision, message },
                    () => setMessage(""),
                  )
                }
                onSplit={projectId ? () => setSplitting(true) : undefined}
              />
            </aside>
            <ChangeReview
              tree={tree}
              selected={selected}
              diff={diff}
              missing={missing}
              split={split}
              onSplit={setSplit}
              line={line}
              onLineShown={() => setLine(undefined)}
              onOpenFile={onOpenFile}
              onAsk={onAsk}
            />
          </div>
        )
      )}
      {splitting && projectId && (
        <CommitSplitSheet
          where={projectId}
          onClose={() => setSplitting(false)}
          onDone={(next, made) => {
            setSplitting(false);
            working.settle(
              next,
              `Made ${made} ${made === 1 ? "commit" : "commits"} locally. Push when you’re ready to share them.`,
            );
          }}
        />
      )}
      {push && tree && (
        <PushDialog
          tree={tree}
          busy={busy}
          error={error}
          onPush={() =>
            void act({ kind: "push", revision: tree.revision }, () =>
              setPush(false),
            )
          }
          onClose={() => !busy && setPush(false)}
        />
      )}
    </section>
  );
}
