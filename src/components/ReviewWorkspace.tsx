import { LocalChanges } from "./LocalChanges";
import { AskCodex } from "./AskCodex";
import type { QuestionTarget } from "../../shared/questions";
import type { ChecksController } from "../lib/useProjectChecks";
import { ProjectChecksButton } from "./ProjectChecks";
import type { ReviewProgressController } from "../lib/useReviewProgress";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Settings2,
  Terminal,
  WrapText,
  UnfoldVertical,
  X,
  Bookmark,
  Send,
  Plus,
  Undo2,
  Pencil,
} from "lucide-react";
import type {
  ChangedFile,
  Draft,
  Progress,
  Pull,
  ReviewComment,
  Side,
} from "../../shared/types";
import { revisionOf } from "../../shared/types";
import { api } from "../lib/api";
import {
  Avatar,
  ErrorBox,
  IconButton,
  Loading,
  Modal,
  RichText,
  relativeDate,
} from "./ui";
import { DiffViewer } from "./DiffViewer";
interface Props {
  onSettings: () => void;
  onDiscuss: (target: QuestionTarget) => void;
  checks: ChecksController;
  pull: Pull;
  file?: ChangedFile;
  files: ChangedFile[];
  progressController: ReviewProgressController;
  onCommentPaths: (paths: string[]) => void;
  onError: (e: unknown) => void;
  onRefresh: () => Promise<void>;
  onSelectFile: (s: string) => void;
  paneControls: ReactNode;
  onEditFile: (path: string, line?: number) => void;
  onFileViewed: (path: string, progress: Progress) => void;
}
export function ReviewWorkspace({
  onSettings,
  onDiscuss,
  checks,
  pull,
  file,
  files,
  progressController,
  onCommentPaths,
  onError,
  onRefresh,
  onSelectFile,
  paneControls,
  onEditFile,
  onFileViewed,
}: Props) {
  const [question, setQuestion] = useState<{
    pull: Pull;
    file: ChangedFile;
    target: QuestionTarget;
  } | null>(null);
  const [tab, setTab] = useState<"files" | "conversation" | "local">("files"),
    [layout, setLayout] = useState<"split" | "unified">("split"),
    [wrap, setWrap] = useState(false),
    [fullContext, setFullContext] = useState(false),
    [reviewOpen, setReviewOpen] = useState(false),
    [draftsOpen, setDraftsOpen] = useState(false),
    [folderOpen, setFolderOpen] = useState(false),
    [codex, setCodex] = useState<{
      path: string;
      line: number;
      side: Side;
      body: string;
    } | null>(null),
    [expandedRead, setExpandedRead] = useState<string | null>(null);
  const { progress, initial, update, retrySave, saveState } =
    progressController;
  const current = useRef(progress);
  current.current = progress;
  const qc = useQueryClient();
  const revision = revisionOf(pull);
  useEffect(() => setExpandedRead(null), [file?.filename]);
  const reviews = useInfiniteQuery({
    queryKey: ["reviews", pull.owner, pull.name, pull.number, pull.head.sha],
    queryFn: ({ pageParam }) => api.reviews(pull, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
  });
  // Review metadata is small; page it fully so line discussions cannot silently disappear.
  useEffect(() => {
    if (reviews.hasNextPage && !reviews.isFetchingNextPage)
      void reviews.fetchNextPage();
  }, [reviews.hasNextPage, reviews.isFetchingNextPage, reviews.data]);
  const allReviews = reviews.data?.pages.flatMap((p) => p.items) ?? [];
  const comments = useQuery({
    queryKey: [
      "reviewComments",
      pull.owner,
      pull.name,
      pull.number,
      allReviews.map((r) => r.id),
    ],
    queryFn: async () => {
      const result: ReviewComment[] = [];
      // Bound concurrency: large histories never fire hundreds of requests at once.
      for (let i = 0; i < allReviews.length; i += 3) {
        const batch = await Promise.all(
          allReviews
            .slice(i, i + 3)
            .filter((r) => r.comments_count !== 0)
            .map((r) => api.reviewComments(pull, r.id)),
        );
        result.push(...batch.flat());
      }
      return result;
    },
    enabled: reviews.isSuccess && !reviews.hasNextPage,
  });
  useEffect(() => {
    if (comments.data)
      onCommentPaths([
        ...new Set(comments.data.filter((c) => !c.resolver).map((c) => c.path)),
      ]);
  }, [comments.data, onCommentPaths]);
  const folder = useQuery({
    queryKey: ["folder", pull.owner, pull.name],
    queryFn: () => api.folder(pull),
  });
  const link = async () => {
    try {
      const result = await api.linkFolder(pull);
      if (result) qc.setQueryData(["folder", pull.owner, pull.name], result);
    } catch (e) {
      onError(e);
    }
  };
  const toggleRead = useCallback(() => {
    if (!file || !initial.isSuccess) return;
    setExpandedRead(null);
    const markingRead = current.current.read[file.filename] !== revision;
    const next = update((p) => {
      const read = { ...p.read };
      if (read[file.filename] === revision) delete read[file.filename];
      else read[file.filename] = revision;
      return { ...p, read };
    });
    if (markingRead) onFileViewed(file.filename, next);
    else onSelectFile(file.filename);
  }, [file, revision, update, initial.isSuccess, onFileViewed, onSelectFile]);
  const index = files.findIndex((f) => f.filename === file?.filename);
  const move = (n: number) => {
    const next = files[index + n];
    if (next) {
      setExpandedRead(null);
      onSelectFile(next.filename);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        tab !== "files" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement)?.isContentEditable ||
        document.querySelector("dialog[open]")
      )
        return;
      if (e.key === "v") {
        e.preventDefault();
        if (!e.repeat) toggleRead();
      }
      if (e.key === "j") {
        e.preventDefault();
        move(1);
      }
      if (e.key === "k") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
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
    id?: string,
  ) => {
    const draft: Draft = {
      id: id ?? crypto.randomUUID(),
      path,
      line,
      side,
      body,
      revision,
      createdAt: new Date().toISOString(),
    };
    update((p) => ({
      ...p,
      drafts: [...p.drafts.filter((d) => d.id !== draft.id), draft],
    }));
    return draft.id;
  };
  const removeDraft = (id: string) =>
    update((p) => ({ ...p, drafts: p.drafts.filter((d) => d.id !== id) }));
  const reply = async (id: number, body: string) => {
    await api.reply(pull, id, body);
    await qc.invalidateQueries({ queryKey: ["reviewComments"] });
  };
  return (
    <>
      <header className="titlebar review-titlebar">
        <div className="breadcrumb">
          <span>{pull.owner}</span>
          <ChevronRight size={13} />
          <strong>{pull.name}</strong>
          <span className="pr-number">#{pull.number}</span>
        </div>
        <div className="toolbar-actions">
          {paneControls}
          <ProjectChecksButton checks={checks} onOpenFile={onEditFile} />
          <IconButton
            label="Open pull request in Gitea"
            onClick={() => void api.openExternal(pull.html_url).catch(onError)}
          >
            <ArrowUpRight size={18} />
          </IconButton>
          <button
            className="primary review-button"
            onClick={() => setReviewOpen(true)}
            disabled={!initial.isSuccess}
          >
            Finish review{draftCount > 0 && <span>{draftCount}</span>}
            <ChevronDown size={13} />
          </button>
          <IconButton label="Open settings" onClick={onSettings}>
            <Settings2 size={16} />
          </IconButton>
        </div>
      </header>
      <section className="pr-heading">
        <div className="pr-heading-top">
          <span className={`state-badge ${pull.state}`}>
            <GitPullRequest size={13} />
            {pull.merged
              ? "Merged"
              : pull.draft
                ? "Draft"
                : pull.state === "open"
                  ? "Open"
                  : "Closed"}
          </span>
          <span className="muted">
            #{pull.number} opened by <strong>{pull.user.login}</strong>
          </span>
        </div>
        <h1>{pull.title}</h1>
        <div className="branch-line">
          <GitBranch size={14} />
          <code>{pull.head.ref}</code>
          <span>→</span>
          <code>{pull.base.ref}</code>
          <span className="branch-divider" />
          <span className="additions">+{pull.additions ?? 0}</span>
          <span className="deletions">−{pull.deletions ?? 0}</span>
          <span className="push-date">
            Updated {relativeDate(pull.updated_at)} ago
          </span>
        </div>
      </section>
      <div className="review-tabs">
        <div className="tab-buttons">
          <button
            className={tab === "files" ? "active" : ""}
            onClick={() => setTab("files")}
          >
            <FileCode2 size={15} />
            Files changed<span>{pull.changed_files}</span>
          </button>
          <button
            className={tab === "conversation" ? "active" : ""}
            onClick={() => setTab("conversation")}
          >
            <MessageSquare size={15} />
            Conversation
          </button>
          <button
            className={tab === "local" ? "active" : ""}
            onClick={() => setTab("local")}
          >
            <GitBranch size={15} />
            Local changes
          </button>
        </div>
        <div className="review-progress">
          <span>
            {readCount} of {pull.changed_files} reviewed
          </span>
          <div>
            <i
              style={{
                width: `${pull.changed_files ? (readCount / pull.changed_files) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>
      {tab === "local" ? (
        <LocalChanges key={`${pull.owner}/${pull.name}`} pull={pull} />
      ) : tab === "files" ? (
        <>
          <div className="file-toolbar">
            <div className="file-name">
              <FileCode2 size={15} />
              <select
                aria-label="Current file"
                value={file?.filename ?? ""}
                onChange={(e) => onSelectFile(e.target.value)}
              >
                {files.map((f) => (
                  <option key={f.filename} value={f.filename}>
                    {f.filename}
                  </option>
                ))}
              </select>
            </div>
            <div className="toolbar-actions">
              <button
                className="edit-file-button"
                disabled={!file || file.status === "deleted"}
                onClick={() => file && onEditFile(file.filename)}
                title="Edit this file in the linked local checkout"
              >
                <Pencil size={14} /> Edit locally
              </button>
              <div className="segmented diff-toggle">
                <button
                  aria-label="Side by side diff"
                  className={layout === "split" ? "active" : ""}
                  onClick={() => setLayout("split")}
                >
                  Split
                </button>
                <button
                  aria-label="Unified diff"
                  className={layout === "unified" ? "active" : ""}
                  onClick={() => setLayout("unified")}
                >
                  Unified
                </button>
              </div>
              <IconButton
                label="Show unchanged lines"
                active={fullContext}
                onClick={() => setFullContext((v) => !v)}
              >
                <UnfoldVertical size={16} />
              </IconButton>
              <IconButton
                label="Wrap long lines"
                active={wrap}
                onClick={() => setWrap((v) => !v)}
              >
                <WrapText size={16} />
              </IconButton>
              <button
                className={`read-button ${read ? "is-read" : ""}`}
                onClick={toggleRead}
                disabled={!file || !initial.isSuccess}
              >
                <span className="checkbox">{read && <Check size={11} />}</span>
                Viewed<kbd>V</kbd>
              </button>
            </div>
          </div>
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
          {read && expandedRead !== file?.filename ? (
            <div className="empty reviewed-empty">
              <span className="reviewed-icon">
                <CheckCheck size={28} />
              </span>
              <h2>
                {readCount === pull.changed_files
                  ? "All files reviewed."
                  : "One file closer."}
              </h2>
              <p>
                <strong>{file?.filename.split("/").pop()}</strong> is marked as
                read.
                <br />
                Your place is saved for this revision.
              </p>
              <div>
                <button onClick={() => setExpandedRead(file!.filename)}>
                  Expand file
                </button>
                <button
                  className="primary"
                  disabled={index >= files.length - 1}
                  onClick={() => move(1)}
                >
                  Next file <ArrowRightIcon />
                </button>
              </div>
            </div>
          ) : file && initial.isSuccess ? (
            <DiffViewer
              checks={checks.state}
              key={`${file.filename}:${revision}`}
              pull={pull}
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
              onAskCodex={(target) =>
                setQuestion({ pull, file: file!, target })
              }
              onError={onError}
              onEditLine={(line) => onEditFile(file.filename, line)}
              onMark={(start, end, side) =>
                update((p) => ({
                  ...p,
                  marks: [
                    ...p.marks,
                    {
                      id: crypto.randomUUID(),
                      path: file.filename,
                      start,
                      end,
                      side,
                      revision,
                    },
                  ],
                }))
              }
              onRemoveMark={(id) =>
                update((p) => ({
                  ...p,
                  marks: p.marks.filter((m) => m.id !== id),
                }))
              }
            />
          ) : (
            <Loading text="Loading changed files…" />
          )}
          <footer className="diff-footer">
            <div className="footer-left">
              <button
                className={saveState.startsWith("Not") ? "deletions" : ""}
                onClick={retrySave}
              >
                <span
                  className={`dot ${saveState.startsWith("Not") ? "red" : "green"}`}
                />
                {saveState}
              </button>
              <span>·</span>
              <button onClick={() => setDraftsOpen(true)}>
                <MessageSquare size={12} />
                {draftCount} draft{draftCount !== 1 ? "s" : ""}
              </button>
            </div>
            <div className="footer-right">
              <span>
                {index + 1} / {pull.changed_files}
              </span>
              <IconButton
                label="Previous file · K"
                disabled={index <= 0}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={15} />
              </IconButton>
              <IconButton
                label="Next file · J"
                disabled={index >= files.length - 1}
                onClick={() => move(1)}
              >
                <ChevronRight size={15} />
              </IconButton>
              <button
                className={folder.data ? "linked-folder" : ""}
                onClick={() => setFolderOpen(true)}
              >
                <FolderGit2 size={14} />
                {folder.data ? "Repository linked" : "Link local folder"}
              </button>
            </div>
          </footer>
        </>
      ) : (
        <Conversation
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
            update((p) => ({
              ...p,
              reviewBody: "",
              drafts: p.drafts.filter((d) => !ids.includes(d.id)),
            }));
            void onRefresh();
          }}
        />
      )}
      {draftsOpen && (
        <Modal title="Your draft comments" onClose={() => setDraftsOpen(false)}>
          <p className="muted">
            Drafts stay on this device until you finish your review.
          </p>
          {!progress.drafts.length && (
            <p>
              No draft comments yet. Select a line in the diff to start one.
            </p>
          )}
          {progress.drafts.map((d) => (
            <article className="draft-card" key={d.id}>
              <button
                className="text-button"
                onClick={() => {
                  onSelectFile(d.path);
                  setExpandedRead(d.path);
                  setDraftsOpen(false);
                }}
              >
                {d.path}:{d.line}
              </button>
              {d.revision !== revision && (
                <span className="warning-note">
                  Older revision — copy this feedback and anchor it to the
                  current code.
                </span>
              )}
              <RichText text={d.body || "Empty draft"} />
              <button
                className="text-button danger"
                onClick={() => removeDraft(d.id)}
              >
                Delete draft
              </button>
            </article>
          ))}
        </Modal>
      )}
      {folderOpen && (
        <Modal title="Local repository" onClose={() => setFolderOpen(false)}>
          <p className="muted">
            Link this project to a Git checkout to send line comments to Codex
            CLI.
          </p>
          {folder.error && <ErrorBox error={folder.error} />}{" "}
          {folder.data ? (
            <div className="folder-info">
              <code>{folder.data.path}</code>
              <p>
                <GitBranch size={14} />
                {folder.data.branch} · {folder.data.head.slice(0, 8)}
              </p>
              <span>
                {folder.data.dirty
                  ? "Has uncommitted changes"
                  : "Working tree is clean"}
              </span>
              {folder.data.head !== pull.head.sha && (
                <p className="warning-note">
                  Check out PR commit {pull.head.sha.slice(0, 8)} before
                  launching Codex. Relay never switches branches or
                  overwrites your work.
                </p>
              )}
            </div>
          ) : (
            <p>No folder linked yet.</p>
          )}
          <button className="primary" onClick={() => void link()}>
            <FolderGit2 size={15} />
            {folder.data ? "Choose another folder" : "Choose repository folder"}
          </button>
        </Modal>
      )}
      {question && (
        <AskCodex
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
function ArrowRightIcon() {
  return <ChevronRight size={15} />;
}
function ReviewSheet({
  pull,
  progress,
  onBody,
  onClose,
  onSubmitted,
}: {
  pull: Pull;
  progress: Progress;
  onBody: (s: string) => void;
  onClose: () => void;
  onSubmitted: (ids: string[]) => void;
}) {
  const [event, setEvent] = useState<
      "COMMENT" | "APPROVED" | "REQUEST_CHANGES"
    >("COMMENT"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const body = progress.reviewBody ?? "";
  const revision = revisionOf(pull),
    drafts = progress.drafts.filter(
      (d) => d.body.trim() && d.revision === revision,
    ),
    stale = progress.drafts.filter(
      (d) => d.revision !== revision && d.body.trim(),
    );
  return (
    <Modal
      title="Finish your review"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        {drafts.length} inline comment{drafts.length !== 1 ? "s" : ""} will be
        published to Gitea.
      </p>
      {stale.length > 0 && (
        <p className="warning-note">
          {stale.length} draft{stale.length !== 1 ? "s" : ""} from an older
          revision will stay saved locally. Re-anchor them before publishing.
        </p>
      )}
      <label>
        Review summary
        <textarea
          autoFocus
          rows={5}
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder="What should the author know?"
          maxLength={65536}
        />
      </label>
      <div className="review-options">
        {(
          [
            ["COMMENT", "Comment", "Share feedback without a decision."],
            ["APPROVED", "Approve", "These changes look good to go."],
            [
              "REQUEST_CHANGES",
              "Request changes",
              "There are things to address before merging.",
            ],
          ] as const
        ).map(([v, title, detail]) => (
          <label key={v} className={v === event ? "selected" : ""}>
            <input
              type="radio"
              name="review-event"
              value={v}
              checked={event === v}
              onChange={() => setEvent(v)}
            />
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
          </label>
        ))}
      </div>
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        <button onClick={onClose} disabled={busy}>
          Keep reviewing
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            (event === "COMMENT" && !body.trim() && !drafts.length) ||
            (event === "REQUEST_CHANGES" && !body.trim())
          }
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await api.submitReview(pull, pull.head.sha, event, body, drafts);
              onSubmitted(drafts.map((d) => d.id));
              onClose();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Publishing…" : "Submit review"}
          <Send size={14} />
        </button>
      </div>
    </Modal>
  );
}
function Conversation({
  pull,
  reviews,
  comments,
  onError,
  onSelectFile,
}: {
  pull: Pull;
  reviews: {
    id: number;
    body: string;
    state: string;
    user: { login: string };
  }[];
  comments: ReviewComment[];
  onError: (e: unknown) => void;
  onSelectFile: (s: string) => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false);
  const discussion = useInfiniteQuery({
    queryKey: ["discussion", pull.owner, pull.name, pull.number],
    queryFn: ({ pageParam }) => api.discussion(pull, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
  });
  return (
    <div className="conversation">
      <article className="discussion-card description">
        <div>
          <Avatar name={pull.user.login} />
          <strong>{pull.user.login}</strong>
          <span className="muted">opened this pull request</span>
        </div>
        <RichText text={pull.body || "No description provided."} />
      </article>
      {reviews.map((r) => (
        <article className="discussion-card" key={`r${r.id}`}>
          <div>
            <Avatar name={r.user?.login ?? "Team"} />
            <strong>{r.user?.login ?? "Review team"}</strong>
            <span className="review-state">
              {r.state.toLowerCase().replaceAll("_", " ")}
            </span>
          </div>
          {r.body && <RichText text={r.body} />}
        </article>
      ))}
      {comments
        .filter((c) => c.commit_id !== pull.head.sha)
        .map((c) => (
          <article className="discussion-card" key={`c${c.id}`}>
            <span className="warning-note">Comment on an earlier revision</span>
            <button
              className="text-button"
              onClick={() => onSelectFile(c.path)}
            >
              {c.path}:{c.position || c.original_position}
            </button>
            <RichText text={c.body} />
            <small>{c.user.login}</small>
          </article>
        ))}
      {discussion.isPending && <Loading />}
      {discussion.error && (
        <ErrorBox
          error={discussion.error}
          retry={() => void discussion.refetch()}
        />
      )}{" "}
      {discussion.data?.pages
        .flatMap((p) => p.items)
        .map((c) => (
          <article className="discussion-card" key={`d${c.id}`}>
            <div>
              <Avatar name={c.user.login} />
              <strong>{c.user.login}</strong>
              <time>{relativeDate(c.created_at)} ago</time>
            </div>
            <RichText text={c.body} />
          </article>
        ))}
      {discussion.hasNextPage && (
        <button onClick={() => void discussion.fetchNextPage()}>
          Load older conversation
        </button>
      )}
      <form
        className="discussion-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.comment(pull, body);
            setBody("");
            await qc.invalidateQueries({ queryKey: ["discussion"] });
          } catch (e) {
            onError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Add to the conversation
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment…"
            rows={4}
          />
        </label>
        <button className="primary" disabled={!body.trim() || busy}>
          {busy ? "Posting…" : "Post comment"}
        </button>
      </form>
    </div>
  );
}
function CodexSheet({
  pull,
  target,
  linked,
  onLink,
  onClose,
}: {
  pull: Pull;
  target: { path: string; line: number; side: Side; body: string };
  linked: boolean;
  onLink: () => Promise<void>;
  onClose: () => void;
}) {
  const [body, setBody] = useState(target.body),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return (
    <Modal title="Fix with Codex" onClose={onClose}>
      <div className="codex-target">
        <Terminal size={19} />
        <div>
          <strong>{target.path}</strong>
          <small>
            Line {target.line} · {target.side === "deletions" ? "Base" : "Head"}{" "}
            · {pull.head.sha.slice(0, 8)}
          </small>
        </div>
      </div>
      <label>
        Instructions
        <textarea
          autoFocus
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="field-note">
        Opens an interactive Codex CLI session in your linked folder, with
        workspace-write sandboxing and approval prompts. Uses your existing
        Codex login. No automatic commit or push.
      </p>
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        {!linked ? (
          <button className="primary" onClick={() => void onLink()}>
            Link a repository first
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || !body.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.launchCodex(
                  pull,
                  pull.head.sha,
                  target.path,
                  target.line,
                  target.side,
                  body,
                );
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Terminal size={15} />
            {busy ? "Opening terminal…" : "Open Codex CLI"}
          </button>
        )}
      </div>
    </Modal>
  );
}
