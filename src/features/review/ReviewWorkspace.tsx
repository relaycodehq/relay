import { LocalChanges } from "../changes/LocalChanges";
import { AskAboutLines } from "./AskAboutLines";
import type { QuestionTarget } from "../../../shared/questions";
import type { ChecksController } from "../checks/useProjectChecks";
import type { ReviewProgressController } from "./useReviewProgress";
import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ChangedFile,
  Draft,
  Progress,
  Pull,
  Side,
} from "../../../shared/types";
import { revisionOf } from "../../../shared/types";
import { api } from "../../lib/api";
import { ErrorBox, Loading } from "../../ui/ui";
import { DiffViewer } from "../diff/DiffViewer";
import { useSplitDiff } from "../diff/WorkingDiff";
import { useElementWidth } from "../../lib/useElementWidth";
import { useTypography } from "../../lib/typography";
import { persistedStore } from "../../lib/persisted-store";
import {
  addMark,
  afterSubmit,
  dropDraft,
  dropMark,
  putDraft,
} from "./review-progress";
import { useReviewComments } from "./useReviewComments";
import { useLinkedFolder } from "./useLinkedFolder";
import { useReviewSteps } from "./useReviewSteps";
import type { PaneSlots } from "../../ui/WorkspacePanes";
import { ReviewHeader } from "./ReviewHeader";
import { ReviewTabs, type ReviewTab } from "./ReviewTabs";
import { FileToolbar } from "./FileToolbar";
import { ReviewedFile } from "./ReviewedFile";
import { DiffFooter } from "./DiffFooter";
import { DraftsDialog, FolderDialog } from "./ReviewDialogs";
import { ReviewSheet } from "./ReviewSheet";
import { PullConversation } from "./PullConversation";
import { CodexSheet } from "./CodexSheet";

// Shared by every review and kept across restarts.
const fullContextStore = persistedStore(
  "relay-review-full-context",
  (saved) => saved === "true",
  (on) => String(on),
);

interface Props {
  onDiscuss: (target: QuestionTarget) => void;
  checks: ChecksController;
  pull: Pull;
  /** A project thread's workspace, where local changes and blame are read. */
  workspace?: string;
  file?: ChangedFile;
  files: ChangedFile[];
  progressController: ReviewProgressController;
  /** Viewed files a later push changed. */
  changedSinceViewed: Set<string>;
  onCommentPaths: (paths: string[]) => void;
  onError: (e: unknown) => void;
  onRefresh: () => Promise<void>;
  onSelectFile: (s: string) => void;
  paneControls: ReactNode;
  onEditFile: (path: string, line?: number) => void;
  onFileViewed: (path: string, progress: Progress) => void;
  /** Embedded in a workspace pane: controls move into the pane header. */
  slots?: PaneSlots;
}
/** One PR's review: its files' diffs, its conversation and the local changes beside it. */
export function ReviewWorkspace({
  onDiscuss,
  checks,
  workspace,
  pull,
  file,
  files,
  progressController,
  changedSinceViewed,
  onCommentPaths,
  onError,
  onRefresh,
  onSelectFile,
  paneControls,
  onEditFile,
  onFileViewed,
  slots,
}: Props) {
  const [question, setQuestion] = useState<{
    pull: Pull;
    file: ChangedFile;
    target: QuestionTarget;
  } | null>(null);
  // The typography setting picks how diffs open; the toolbar flips it.
  const { wrap: wrapByDefault } = useTypography();
  const fullContext = fullContextStore.use();
  const [split, setSplit] = useSplitDiff();
  const [tab, setTab] = useState<ReviewTab>("files"),
    [wrap, setWrap] = useState(wrapByDefault),
    [reviewOpen, setReviewOpen] = useState(false),
    [draftsOpen, setDraftsOpen] = useState(false),
    [folderOpen, setFolderOpen] = useState(false),
    [codex, setCodex] = useState<{
      path: string;
      line: number;
      side: Side;
      body: string;
    } | null>(null);
  const { progress, initial, update, retrySave, saveState, saveFailed } =
    progressController;
  const qc = useQueryClient();
  const revision = revisionOf(pull);
  // Side-by-side needs room; a narrow pane falls back to a unified diff.
  const tabsRef = useRef<HTMLDivElement>(null),
    width = useElementWidth(tabsRef),
    narrow = !!width && width < 480,
    layout = narrow || !split ? "unified" : "split";
  const steps = useReviewSteps(
    files,
    file,
    revision,
    progressController,
    onFileViewed,
    onSelectFile,
    tab === "files",
  );
  const {
    reviews,
    all: allReviews,
    comments,
  } = useReviewComments(pull, onCommentPaths);
  const { folder, link } = useLinkedFolder(pull, onError);
  const read = !!file && progress.read[file.filename] === revision;
  const readCount = files.filter(
    (f) => progress.read[f.filename] === revision,
  ).length;
  const draftCount = progress.drafts.filter((d) => d.body.trim()).length;
  const addDraft = (
    path: string,
    line: number,
    side: Side,
    body: string,
    id: string,
  ) => {
    const draft: Draft = {
      id,
      path,
      line,
      side,
      body,
      revision,
      createdAt: new Date().toISOString(),
    };
    update((p) => putDraft(p, draft));
  };
  const removeDraft = (id: string) => update((p) => dropDraft(p, id));
  const reply = async (id: number, body: string) => {
    await api.reply(pull, id, body);
    await qc.invalidateQueries({ queryKey: ["reviewComments"] });
  };
  return (
    <>
      <ReviewHeader
        slots={slots}
        pull={pull}
        paneControls={paneControls}
        checks={checks}
        draftCount={draftCount}
        ready={initial.isSuccess}
        onEditFile={onEditFile}
        onFinish={() => setReviewOpen(true)}
        onError={onError}
      />
      <ReviewTabs
        ref={tabsRef}
        pull={pull}
        tab={tab}
        onTab={setTab}
        readCount={readCount}
      />
      {tab === "local" ? (
        <LocalChanges
          key={`${pull.owner}/${pull.name}`}
          {...(workspace
            ? { projectId: workspace, onOpenFile: onEditFile }
            : { pull })}
        />
      ) : tab === "files" ? (
        <>
          <FileToolbar
            files={files}
            file={file}
            layout={layout}
            narrow={narrow}
            fullContext={fullContext}
            wrap={wrap}
            read={read}
            changedSinceViewed={changedSinceViewed}
            ready={initial.isSuccess}
            onSelectFile={onSelectFile}
            onEditFile={onEditFile}
            onSplit={setSplit}
            onFullContext={() => fullContextStore.set(!fullContext)}
            onWrap={() => setWrap((v) => !v)}
            onToggleRead={steps.toggleRead}
          />
          {file?.previous_filename && (
            <div className="rename-banner">
              Renamed from {file.previous_filename}
            </div>
          )}
          {reviews.error && (
            <ErrorBox
              error={reviews.error}
              retry={() => void reviews.refetch()}
            />
          )}
          {comments.error && (
            <ErrorBox
              error={comments.error}
              retry={() => void comments.refetch()}
            />
          )}
          {initial.error && (
            <ErrorBox
              error={initial.error}
              retry={() => void initial.refetch()}
            />
          )}
          {read && steps.expanded !== file?.filename ? (
            <ReviewedFile
              path={file!.filename}
              allViewed={readCount === pull.changed_files}
              last={steps.index >= files.length - 1}
              onExpand={() => steps.setExpanded(file!.filename)}
              onNext={() => steps.move(1)}
            />
          ) : file && initial.isSuccess ? (
            <DiffViewer
              checks={checks.state}
              key={`${file.filename}:${revision}`}
              pull={pull}
              workspace={workspace}
              file={file}
              layout={layout}
              wrap={wrap}
              fullContext={fullContext}
              comments={comments.data ?? []}
              progress={progress}
              addDraft={addDraft}
              removeDraft={removeDraft}
              onReply={reply}
              onResolve={async (id, resolved) => {
                await api.resolveComment(pull, id, resolved);
                await qc.invalidateQueries({ queryKey: ["reviewComments"] });
              }}
              onCodex={setCodex}
              onDiscuss={onDiscuss}
              onAskAboutLines={(target) =>
                setQuestion({ pull, file: file!, target })
              }
              onError={onError}
              onEditLine={(line) => onEditFile(file.filename, line)}
              onMark={(start, end, side) =>
                update((p) =>
                  addMark(p, {
                    id: crypto.randomUUID(),
                    path: file.filename,
                    start,
                    end,
                    side,
                    revision,
                  }),
                )
              }
              onRemoveMark={(id) => update((p) => dropMark(p, id))}
            />
          ) : (
            <Loading text="Loading changed files…" />
          )}
          <DiffFooter
            saveState={saveState}
            saveFailed={saveFailed}
            draftCount={draftCount}
            index={steps.index}
            total={pull.changed_files}
            count={files.length}
            linked={!!folder.data}
            onRetrySave={retrySave}
            onDrafts={() => setDraftsOpen(true)}
            onMove={steps.move}
            onFolder={() => setFolderOpen(true)}
          />
        </>
      ) : (
        <PullConversation
          pull={pull}
          reviews={allReviews}
          comments={comments.data ?? []}
          onError={onError}
          onSelectFile={(path) => {
            onSelectFile(path);
            setTab("files");
          }}
        />
      )}
      {reviewOpen && (
        <ReviewSheet
          pull={pull}
          progress={progress}
          onBody={(body) => update((p) => ({ ...p, reviewBody: body }))}
          onClose={() => setReviewOpen(false)}
          onSubmitted={(ids) => {
            update((p) => afterSubmit(p, ids));
            void onRefresh();
          }}
        />
      )}
      {draftsOpen && (
        <DraftsDialog
          drafts={progress.drafts}
          revision={revision}
          onOpen={(d) => {
            onSelectFile(d.path);
            steps.setExpanded(d.path);
            setDraftsOpen(false);
          }}
          onDelete={removeDraft}
          onClose={() => setDraftsOpen(false)}
        />
      )}
      {folderOpen && (
        <FolderDialog
          pull={pull}
          folder={folder}
          onLink={() => void link()}
          onClose={() => setFolderOpen(false)}
        />
      )}
      {question && (
        <AskAboutLines
          pull={question.pull}
          file={question.file}
          target={question.target}
          folder={folder.data}
          onLink={link}
          onClose={() => setQuestion(null)}
        />
      )}
      {codex && (
        <CodexSheet
          pull={pull}
          target={codex}
          linked={!!folder.data}
          onLink={link}
          onClose={() => setCodex(null)}
        />
      )}
    </>
  );
}
