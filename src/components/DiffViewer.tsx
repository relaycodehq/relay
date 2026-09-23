import type { QuestionTarget } from "../../shared/questions";
import { useSymbolNavigation } from "./SymbolNavigation";
import { useLineBlame } from "./LineBlame";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  diagnosticSummary,
  diagnosticSeverity,
  type ProjectCheckState,
  type ProjectDiagnostic,
} from "../../shared/checks";
import { useContentHash } from "../lib/diagnostics";
import { DiagnosticMessage } from "./ProjectChecks";
import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CodeViewDiffItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
  CodeViewLineSelection,
} from "@pierre/diffs";
import {
  Bookmark,
  MessageSquare,
  Terminal,
  Trash2,
  X,
  Pencil,
} from "lucide-react";
import type {
  ChangedFile,
  Draft,
  LineMark,
  Progress,
  Pull,
  ReviewComment,
  Side,
} from "../../shared/types";
import { revisionOf } from "../../shared/types";
import { api } from "../lib/api";
import { StyledDiffCodeView } from "../vendor/t3code/StyledDiffCodeView";
import { ErrorBox, IconButton, Loading, RichText } from "./ui";
import { useTheme } from "../lib/useTheme";
import { useSyntaxThemes } from "../lib/appearance";
import DiffWorker from "../lib/diff.worker?worker";
import { labelDiffGapControls } from "../lib/diffGapControls";
interface Props {
  checks?: ProjectCheckState | null;
  pull: Pull;
  file: ChangedFile;
  layout: "split" | "unified";
  wrap: boolean;
  fullContext: boolean;
  comments: ReviewComment[];
  progress: Progress;
  addDraft: (
    path: string,
    line: number,
    side: Side,
    body: string,
    id: string,
  ) => void;
  removeDraft: (id: string) => void;
  onReply: (id: number, body: string) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => Promise<void>;
  onCodex: (t: {
    path: string;
    line: number;
    side: Side;
    body: string;
  }) => void;
  onError: (e: unknown) => void;
  onMark: (start: number, end: number, side: Side) => void;
  onRemoveMark: (id: string) => void;
  onAskCodex: (target: QuestionTarget) => void;
  onDiscuss: (target: QuestionTarget) => void;
  onEditLine: (line: number) => void;
}
interface Annotation {
  diagnostics: ProjectDiagnostic[];
  comments: ReviewComment[];
  drafts: Draft[];
  marks: LineMark[];
  composer?: boolean;
  line: number;
  side: Side;
}
export function DiffViewer({
  checks,
  pull,
  file,
  layout,
  wrap,
  fullContext,
  comments,
  progress,
  addDraft,
  removeDraft,
  onReply,
  onResolve,
  onCodex,
  onError,
  onMark,
  onRemoveMark,
  onEditLine,
  onAskCodex,
  onDiscuss,
}: Props) {
  const contents = useQuery({
    queryKey: [
      "contents",
      pull.owner,
      pull.name,
      pull.number,
      pull.head.sha,
      pull.merge_base,
      file.filename,
    ],
    queryFn: () => api.contents(pull, file, pull.head.sha, pull.merge_base),
    gcTime: 0,
    staleTime: Infinity,
  });
  const viewer = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const [problemLine, setProblemLine] = useState<number>();
  useEffect(() => {
    if (problemLine === undefined) return;
    const frame = requestAnimationFrame(() =>
      viewer.current?.scrollTo({
        type: "line",
        id: file.filename,
        lineNumber: problemLine,
        side: "additions",
        align: "center",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [problemLine]);
  const contentHash = useContentHash(contents.data?.next?.contents);
  const symbols = useSymbolNavigation(pull, file.filename, contentHash, checks);
  const blame = useLineBlame(
    pull,
    {
      deletions: {
        revision: pull.merge_base,
        path: file.previous_filename || file.filename,
        label: "Before this PR",
      },
      additions: {
        revision: pull.head.sha,
        path: file.filename,
        label: "PR head",
      },
    },
    layout,
  );
  const checked =
    checks?.status === "ready" ? checks.files[file.filename] : undefined;
  const aligned = !!checked && checked.hash === contentHash;
  const fileDiagnostics = useMemo(
    () =>
      checks?.status === "ready"
        ? checks.diagnostics.filter((d) => d.path === file.filename)
        : [],
    [checks, file.filename],
  );
  const [diff, setDiff] = useState<FileDiffMetadata>(),
    [diffError, setDiffError] = useState<unknown>(),
    [selection, setSelection] = useState<CodeViewLineSelection | null>(null),
    [composer, setComposer] = useState<{
      id: string;
      line: number;
      side: Side;
    } | null>(null);
  const revision = revisionOf(pull);
  const theme = useTheme();
  const syntaxThemes = useSyntaxThemes();
  const [highlightLarge, setHighlightLarge] = useState(false);
  const isLarge =
    !!diff &&
    Math.max(diff.additionLines.length, diff.deletionLines.length) > 5000;
  useEffect(() => {
    if (!contents.data || contents.data.binary) return;
    setDiff(undefined);
    setDiffError(undefined);
    const worker = new DiffWorker();
    const timer = setTimeout(() => {
      worker.terminate();
      setDiffError(
        new Error(
          "This diff took too long to compute. Open the file in your local editor.",
        ),
      );
    }, 12000);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      if (e.data.error) setDiffError(new Error(e.data.error));
      else setDiff(e.data.value);
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(timer);
      setDiffError(new Error("Could not compute this diff. Refresh to retry."));
      worker.terminate();
    };
    worker.postMessage(contents.data);
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [contents.data]);
  const annotations = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<Annotation>>();
    const get = (line: number, side: Side) => {
      const key = `${side}:${line}`;
      if (!map.has(key))
        map.set(key, {
          lineNumber: line,
          side,
          metadata: {
            line,
            side,
            comments: [],
            drafts: [],
            marks: [],
            diagnostics: [],
          },
        });
      return map.get(key)!.metadata;
    };
    for (const c of comments) {
      if (c.path !== file.filename || c.commit_id !== pull.head.sha) continue;
      const line = c.position || c.original_position;
      if (line > 0)
        get(line, c.position > 0 ? "additions" : "deletions").comments.push(c);
    }
    for (const d of progress.drafts)
      if (
        d.path === file.filename &&
        d.revision === revision &&
        d.id !== composer?.id
      )
        get(d.line, d.side).drafts.push(d);
    for (const m of progress.marks)
      if (m.path === file.filename && m.revision === revision)
        get(m.end, m.side).marks.push(m);
    if (aligned)
      for (const d of fileDiagnostics)
        if (d.line) get(d.line, "additions").diagnostics.push(d);
    if (composer) get(composer.line, composer.side).composer = true;
    return [...map.values()];
  }, [
    comments,
    progress,
    file.filename,
    revision,
    composer,
    pull.head.sha,
    aligned,
    fileDiagnostics,
  ]);
  const items = useMemo<CodeViewDiffItem<Annotation>[]>(
    () =>
      diff
        ? [
            {
              id: file.filename,
              type: "diff",
              fileDiff: diff,
              annotations,
              version: Date.now(),
            },
          ]
        : [],
    [diff, annotations, file.filename],
  );
  const beginComment = (range: SelectedLineRange | null) => {
    if (range)
      setComposer({
        id: crypto.randomUUID(),
        line: range.end,
        side: range.endSide ?? range.side ?? "additions",
      });
  };
  if (contents.error)
    return (
      <div className="diff-state">
        <ErrorBox
          error={contents.error}
          retry={() => void contents.refetch()}
        />
        <p>Other files remain available in the sidebar.</p>
      </div>
    );
  if (contents.isPending) return <Loading text="Loading this file…" />;
  if (contents.data.binary)
    return (
      <div className="empty">
        <span className="binary-icon">01</span>
        <h2>Binary or Git LFS file</h2>
        <p>This file can’t be displayed as a text diff.</p>
        <button
          onClick={() =>
            void api.openExternal(pull.html_url + "/files").catch(onError)
          }
        >
          Open in Gitea
        </button>
      </div>
    );
  if (diffError)
    return (
      <div className="diff-state">
        <ErrorBox error={diffError} />
      </div>
    );
  if (!diff) return <Loading text="Comparing file versions…" />;
  return (
    <div className="diff-wrapper" {...blame.handlers}>
      {blame.overlay}
      {symbols.overlay}
      {symbols.ready && symbols.controls}
      {isLarge && !highlightLarge && (
        <div className="large-file-note">
          <span>Large file · fast text view keeps memory low</span>
          <button onClick={() => setHighlightLarge(true)}>
            Enable syntax highlighting
          </button>
        </div>
      )}
      {selection && (
        <div className="selection-toolbar">
          <span>
            {selection.range.side === "deletions" ? "Base" : "Head"} ·{" "}
            {selection.range.start === selection.range.end
              ? `line ${selection.range.start}`
              : `lines ${selection.range.start}–${selection.range.end}`}
          </span>
          <button
            onClick={() => {
              const range = selection.range;
              if (range.endSide && range.endSide !== range.side) {
                onError(new Error("Select lines on one side to ask Codex."));
                return;
              }
              const start = Math.min(range.start, range.end),
                end = Math.max(range.start, range.end);
              if (end - start >= 200) {
                onError(new Error("Select up to 200 lines to ask Codex."));
                return;
              }
              onAskCodex({
                path: file.filename,
                start,
                end,
                side: range.side ?? "additions",
              });
            }}
          >
            <Terminal size={13} /> Ask Codex
          </button>
          <button
            onClick={() => {
              const range = selection.range,
                start = Math.min(range.start, range.end),
                end = Math.max(range.start, range.end);
              if (
                (range.endSide && range.endSide !== range.side) ||
                end - start >= 200
              ) {
                onError(
                  new Error("Select up to 200 lines on one side to discuss."),
                );
                return;
              }
              onDiscuss({
                path: file.filename,
                start,
                end,
                side: range.side ?? "additions",
              });
            }}
          >
            <MessageSquare size={13} />
            Discuss in room
          </button>
          <button onClick={() => beginComment(selection.range)}>
            <MessageSquare size={13} />
            Comment
          </button>
          {selection.range.side !== "deletions" &&
            selection.range.endSide !== "deletions" && (
              <button
                aria-label="Edit selected line locally"
                onClick={() => onEditLine(selection.range.start)}
              >
                <Pencil size={13} /> Edit locally
              </button>
            )}
          <button
            onClick={() => {
              if (
                selection.range.endSide &&
                selection.range.endSide !== selection.range.side
              ) {
                onError(new Error("Select a range on one side to mark it."));
                return;
              }
              onMark(
                Math.min(selection.range.start, selection.range.end),
                Math.max(selection.range.start, selection.range.end),
                selection.range.side ?? "additions",
              );
              setSelection(null);
            }}
          >
            <Bookmark size={13} />
            Mark for later
          </button>
          <IconButton
            label="Clear selected lines"
            onClick={() => setSelection(null)}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {checks && checks.status !== "stopped" && (
        <div
          className={`file-check-status ${checked?.errors ? "has-errors" : ""}`}
        >
          {checks.status === "checking"
            ? "Checking local project…"
            : checks.status === "failed"
              ? "Live checks unavailable — open project checks for details"
              : !checked
                ? "This file is outside the selected compiler configuration"
                : !aligned
                  ? `Local file differs from PR · ${diagnosticSummary(checked)} in local version`
                  : diagnosticSeverity(checked)
                    ? `${diagnosticSummary(checked)} in this file`
                    : "No compiler errors in this file"}
          {!!fileDiagnostics.length && !aligned && (
            <button onClick={() => onEditLine(fileDiagnostics[0].line ?? 1)}>
              Inspect local diagnostics
            </button>
          )}
        </div>
      )}
      {aligned && !!fileDiagnostics.length && (
        <details className="review-file-problems">
          <summary>Problems in this file · {fileDiagnostics.length}</summary>
          <div>
            {fileDiagnostics.map((d, i) => (
              <button key={i} onClick={() => setProblemLine(d.line ?? 1)}>
                <small>Line {d.line}</small>
                <DiagnosticMessage diagnostic={d} />
              </button>
            ))}
          </div>
        </details>
      )}
      <StyledDiffCodeView<Annotation>
        viewerRef={viewer}
        className="diff-code-view"
        unsafeCSSExtra={`:host {color-scheme:${theme} !important;} [data-diff], [data-file] {transition:none !important; opacity:1 !important;}`}
        items={items}
        selectedLines={selection}
        onSelectedLinesChange={setSelection}
        options={{
          ...symbols.handlers,
          onLineClick: (line) => {
            const event = line.event;
            if (
              line.numberColumn ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.defaultPrevented ||
              !window.getSelection()?.isCollapsed
            )
              return;
            setSelection({
              id: file.filename,
              range: {
                start: line.lineNumber,
                end: line.lineNumber,
                side:
                  "annotationSide" in line ? line.annotationSide : "additions",
              },
            });
          },
          theme: syntaxThemes,
          themeType: theme,
          tokenizeMaxLength: highlightLarge ? 100000 : 5000,
          useTokenTransformer: true,
          preferredHighlighter: "shiki-js",
          diffStyle: layout,
          expandUnchanged: fullContext || problemLine !== undefined,
          diffIndicators: "bars",
          overflow: wrap ? "wrap" : "scroll",
          lineDiffType: "word-alt",
          enableLineSelection: true,
          enableGutterUtility: true,
          onGutterUtilityClick: beginComment,
          disableFileHeader: true,
          hunkSeparators: "line-info",
          tokenizeMaxLineLength: 1000,
          maxLineDiffLength: 1000,
          expansionLineCount: 20,
          onPostRender: (node, _instance, phase) => {
            if (phase !== "unmount") labelDiffGapControls(node);
          },
        }}
        renderAnnotation={(a) => (
          <div className="line-annotations">
            {a.metadata.diagnostics.map((d, i) => (
              <div className={`inline-diagnostic ${d.severity}`} key={i}>
                <DiagnosticMessage diagnostic={d} />
              </div>
            ))}
            {a.metadata.marks.map((m) => (
              <div className="line-bookmark" key={m.id}>
                <Bookmark size={13} />
                <span>
                  Marked for later · lines {m.start}–{m.end}
                </span>
                <IconButton
                  label="Remove line mark"
                  onClick={() => onRemoveMark(m.id)}
                >
                  <X size={13} />
                </IconButton>
              </div>
            ))}
            {a.metadata.comments.map((c) => (
              <ThreadComment
                key={c.id}
                comment={c}
                onReply={onReply}
                onResolve={onResolve}
                onCodex={() =>
                  onCodex({
                    path: file.filename,
                    line: a.metadata.line,
                    side: a.metadata.side,
                    body: c.body,
                  })
                }
                onError={onError}
              />
            ))}
            {a.metadata.drafts.map((d) => (
              <DraftComment
                key={d.id}
                draft={d}
                onChange={(body) =>
                  addDraft(d.path, d.line, d.side, body, d.id)
                }
                onRemove={() => removeDraft(d.id)}
                onCodex={() =>
                  onCodex({
                    path: d.path,
                    line: d.line,
                    side: d.side,
                    body: d.body,
                  })
                }
              />
            ))}
            {a.metadata.composer && (
              <NewComment
                body={
                  progress.drafts.find((d) => d.id === composer?.id)?.body ?? ""
                }
                onChange={(body) => {
                  if (!composer) return;
                  // A draft exists only while it has text, so a box left
                  // open when the reader moves on leaves nothing behind.
                  if (body)
                    addDraft(
                      file.filename,
                      composer.line,
                      composer.side,
                      body,
                      composer.id,
                    );
                  else removeDraft(composer.id);
                }}
                onSave={() => {
                  setComposer(null);
                  setSelection(null);
                }}
                onCancel={() => {
                  if (composer) removeDraft(composer.id);
                  setComposer(null);
                }}
              />
            )}
          </div>
        )}
      />
      {diff.hunks.length === 0 && (
        <div className="unchanged-note">
          {file.previous_filename
            ? "File renamed with no content changes."
            : "No text changes. This may be a file mode change."}
        </div>
      )}
    </div>
  );
}
function NewComment({
  body,
  onChange,
  onSave,
  onCancel,
}: {
  body: string;
  onChange: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="inline-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSave();
      }}
    >
      <div className="comment-heading">
        <strong>New line comment</strong>
        <span>Local draft</span>
      </div>
      <textarea
        autoFocus
        aria-label="Line comment"
        placeholder="What needs a closer look? Markdown supported."
        rows={3}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim()) {
            e.preventDefault();
            onSave();
          }
        }}
      />
      <div className="inline-actions">
        <span>Publish when you finish your review</span>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={!body.trim()}>
          Add draft
        </button>
      </div>
    </form>
  );
}
function DraftComment({
  draft,
  onChange,
  onRemove,
  onCodex,
}: {
  draft: Draft;
  onChange: (s: string) => void;
  onRemove: () => void;
  onCodex: () => void;
}) {
  const [edit, setEdit] = useState(false);
  return (
    <article className="inline-comment draft">
      <div className="comment-heading">
        <strong>You</strong>
        <span className="draft-label">Pending review</span>
        <IconButton label="Delete draft comment" onClick={onRemove}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      {edit ? (
        <textarea
          aria-label="Edit draft comment"
          value={draft.body}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <RichText text={draft.body} />
      )}
      <div className="comment-actions">
        <button onClick={() => setEdit((v) => !v)}>
          {edit ? "Done" : "Edit"}
        </button>
        <button onClick={onCodex} disabled={!draft.body.trim()}>
          <Terminal size={13} />
          Fix with Codex
        </button>
      </div>
    </article>
  );
}
function ThreadComment({
  comment,
  onReply,
  onResolve,
  onCodex,
  onError,
}: {
  comment: ReviewComment;
  onReply: (id: number, body: string) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => Promise<void>;
  onCodex: () => void;
  onError: (e: unknown) => void;
}) {
  const [reply, setReply] = useState(false),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <article className="inline-comment">
      <div className="comment-heading">
        <strong>{comment.user.login}</strong>
        <span>{comment.resolver ? "Resolved" : "Review comment"}</span>
      </div>
      <RichText text={comment.body} />
      <div className="comment-actions">
        <button
          onClick={() =>
            void onResolve(comment.id, !comment.resolver).catch(onError)
          }
        >
          {comment.resolver ? "Reopen" : "Resolve"}
        </button>
        <button onClick={() => setReply((v) => !v)}>
          <MessageSquare size={12} />
          Reply
        </button>
        <button onClick={onCodex}>
          <Terminal size={13} />
          Fix with Codex
        </button>
      </div>
      {reply && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onReply(comment.id, body);
              setBody("");
              setReply(false);
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            aria-label="Reply to line comment"
            placeholder="Reply…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <button className="primary" disabled={!body.trim() || busy}>
            {busy ? "Posting…" : "Post reply"}
          </button>
        </form>
      )}
    </article>
  );
}
