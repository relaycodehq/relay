import { useEffect, useRef, useState } from "react";
import type { Pull } from "../../../shared/types";
import {
  operationInProgress,
  type ChangeArea,
} from "../../../shared/working-tree";
import type { CodeReference } from "../../../shared/code-references";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { api } from "../../lib/api";
import type { RequestChannel } from "../../lib/request-channel";
import { changeSections, gitBlockedReason, folderKey } from "./working-changes";
import { parentOf } from "../../lib/file-tree";
import { useSavedChanges } from "./useSavedChanges";
import { useWorkingDiff, useWorkingTree } from "./useWorkingTree";
import { useChangeReveals } from "./useChangeReveals";
import { ChangesToolbar } from "./local/ChangesToolbar";
import { ListViewToggle } from "./ListViewToggle";
import { ErrorBox, Loading } from "../../ui/ui";
import { PaneResizer } from "../../ui/PaneResizer";
import { CommitSplitSheet } from "./CommitSplit";
import { ChangeList } from "./local/ChangeList";
import { CommitForm } from "./local/CommitForm";
import { ChangeReview } from "./local/ChangeReview";
import { PushDialog } from "./local/PushDialog";
import { useSplitDiff } from "../diff/WorkingDiff";
import type { PaneSlots } from "../../ui/WorkspacePanes";
import { ElsewhereGroups } from "./elsewhere/ElsewhereGroups";
import { ElsewhereReview } from "./elsewhere/ElsewhereReview";
import { useElsewhere, type ElsewherePick } from "./elsewhere/useElsewhere";
import "./working-tree.css";

export function LocalChanges({
  pull,
  projectId,
  onSelection,
  slots,
  onOpenFile,
  onAsk,
  reveals,
  chatId,
  onOpenThread,
  onOpenOutside,
  agentRunning,
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
  /** The thread whose agents' changes in other repositories list under its own. */
  chatId?: string;
  onOpenThread?: (chatId: string) => void;
  /** Opens a file outside the folder by its absolute path. */
  onOpenOutside?: (path: string) => void;
  /** The thread's agent is at work in this folder. */
  agentRunning?: boolean;
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
    [collapsed, setCollapsed] = useState<ChangeArea[]>([]),
    [shutFolders, setShutFolders] = useState<string[]>([]);
  const fileList = useRef<HTMLDivElement>(null);
  const { missing, line, setLine, pick } = useChangeReveals({
    reveals,
    tree,
    selected,
    setSelected,
    onReveal: (area, path) => {
      setCollapsed((c) => c.filter((a) => a !== area));
      const key = folderKey(area, parentOf(path));
      setShutFolders((f) => f.filter((k) => k !== key));
    },
    list: fileList,
  });
  const sections = tree ? changeSections(tree.changes) : [];
  const elsewhere = useElsewhere(chatId).data;
  const [away, setAway] = useState<ElsewherePick | null>(null);
  // A file picked in this folder, by a click or from the chat, takes over the diff.
  useEffect(() => {
    if (selected) setAway(null);
  }, [selected]);
  const awayGroup =
    away && elsewhere?.groups.find((g) => g.root === away.root);
  // Committed or reverted there, it has no diff left to show.
  const awayGone =
    !!away &&
    !!elsewhere &&
    !awayGroup?.files.some((f) => f.path === away.path);
  useEffect(() => {
    if (awayGone) setAway(null);
  }, [awayGone]);
  return (
    <section className="local-changes" aria-label="Local changes">
      <ChangesToolbar
        projectId={projectId}
        slots={slots}
        tree={tree}
        busy={busy}
        onRefresh={() => void state.refetch()}
        onPush={() => setPush(true)}
        agentRunning={agentRunning}
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
          {operationInProgress(tree.operation)}. Finish it in your terminal
          before committing here.
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
                ignored={tree.ignored ?? []}
                revision={tree.revision}
                selected={selected}
                grouped={grouped}
                tools={
                  <ListViewToggle grouped={grouped} onGrouped={setGrouped} />
                }
                collapsed={collapsed}
                onCollapse={(area, collapse) =>
                  setCollapsed((c) =>
                    collapse ? [...c, area] : c.filter((a) => a !== area),
                  )
                }
                shutFolders={shutFolders}
                onShutFolders={(keys, shut) =>
                  setShutFolders((f) => [
                    ...f.filter((k) => !keys.includes(k)),
                    ...(shut ? keys : []),
                  ])
                }
                busy={busy}
                projectId={projectId}
                listRef={fileList}
                onAct={(action) => void act(action)}
                onPick={pick}
                onDismiss={(paths) =>
                  projectId &&
                  void api
                    .projectDismissIgnored(projectId, paths)
                    .then((next) => working.settle(next, ""))
                    .catch(working.setError)
                }
                onOpenFile={onOpenFile}
                onTrashed={() => void state.refetch()}
                onError={working.setError}
                authors={elsewhere?.here}
                onOpenThread={onOpenThread}
                after={
                  chatId &&
                  !!elsewhere?.groups.length && (
                    <ElsewhereGroups
                      chatId={chatId}
                      groups={elsewhere.groups}
                      selected={away}
                      onPick={(pick) => {
                        setSelected(null);
                        setAway(pick);
                      }}
                      onOpenThread={onOpenThread}
                    />
                  )
                }
              />
              <CommitForm
                message={message}
                onMessage={setMessage}
                busy={busy}
                blocked={gitBlockedReason(tree, "commit")}
                canCommit={
                  !busy && !!message.trim() && !!sections[0]?.files.length
                }
                canSplit={!busy && !!tree.changes.length}
                onCommit={() =>
                  void act(
                    { kind: "commit", revision: tree.revision, message },
                    () => setMessage(""),
                  )
                }
                onSplit={projectId ? () => setSplitting(true) : undefined}
              />
            </aside>
            {chatId && away ? (
              <ElsewhereReview
                chatId={chatId}
                pick={away}
                revision={awayGroup?.revision}
                onOpenOutside={onOpenOutside}
              />
            ) : (
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
                onReveal={
                  projectId
                    ? (path) =>
                        void api
                          .revealProjectPath(projectId, path)
                          .catch(working.setError)
                    : undefined
                }
                onAsk={onAsk}
              />
            )}
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
