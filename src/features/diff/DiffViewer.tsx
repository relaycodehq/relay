import type { QuestionTarget } from "../../../shared/questions";
import { useSymbolNavigation } from "./SymbolNavigation";
import { useLineBlame } from "./LineBlame";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { clickedLine } from "./diff-selection";
import type { ProjectCheckState } from "../../../shared/checks";
import { useContentHash } from "../checks/diagnostics";
import { useFileChecks } from "../checks/file-checks";
import { useEffect, useMemo, useState, useRef } from "react";
import type { CodeViewDiffItem, CodeViewLineSelection } from "@pierre/diffs";
import type {
  ChangedFile,
  Progress,
  Pull,
  ReviewComment,
  Side,
} from "../../../shared/types";
import { revisionOf } from "../../../shared/types";
import { api } from "../../lib/api";
import { DiffCodeView } from "./DiffCodeView";
import { ErrorBox, Loading } from "../../ui/ui";
import { useTheme } from "../../lib/useTheme";
import { useAISettings } from "../agents/useAISettings";
import { agentName } from "../../../shared/agents";
import { useSyntaxThemes } from "../../lib/appearance";
import { useFileDiff } from "./useFileDiff";
import { usePullFileContents } from "./usePullFileContents";
import { lineAnnotations, type LineNotes } from "./diff-annotations";
import { useLineComposer } from "./useLineComposer";
import { labelDiffGapControls } from "./diffGapControls";
import { SelectionToolbar } from "./viewer/SelectionToolbar";
import { FileChecks } from "./viewer/FileChecks";
import { LineAnnotations, type NoteActions } from "./viewer/LineAnnotations";
import { useDiffFind } from "./find/useDiffFind";
import { pullHostName } from "../../../shared/source-control";

interface Props extends NoteActions {
  /** A project thread's workspace, where blame is read instead of the PR's linked folder. */
  workspace?: string;
  checks?: ProjectCheckState | null;
  pull: Pull;
  file: ChangedFile;
  layout: "split" | "unified";
  wrap: boolean;
  fullContext: boolean;
  comments: ReviewComment[];
  progress: Progress;
  onMark: (start: number, end: number, side: Side) => void;
  onAskAboutLines: (target: QuestionTarget) => void;
  onDiscuss: (target: QuestionTarget) => void;
  onEditLine: (line: number) => void;
}

/** A PR file's diff with its comments, drafts, marks and problems on the lines. */
export function DiffViewer({
  checks,
  pull,
  workspace,
  file,
  layout,
  wrap,
  fullContext,
  comments,
  progress,
  onError,
  onMark,
  onEditLine,
  onAskAboutLines,
  onDiscuss,
  ...actions
}: Props) {
  const noteActions = { ...actions, onError };
  const questionAgent = agentName(
    useAISettings().data?.questionsProvider ?? "codex",
  );
  const contents = usePullFileContents(pull, file);
  const viewer = useRef<CodeViewHandle<LineNotes, undefined>>(null);
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
  const symbols = useSymbolNavigation(
    pull,
    file.filename,
    contentHash,
    checks,
    "review",
  );
  const blame = useLineBlame(
    workspace ? { projectId: workspace } : pull,
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
  const { checked, aligned, diagnostics } = useFileChecks(
    checks,
    file.filename,
    contentHash,
  );
  const { diff, error: diffError } = useFileDiff(contents.data);
  const frame = useRef<HTMLDivElement>(null);
  const find = useDiffFind({
    frame,
    viewer: () => viewer.current,
    itemId: file.filename,
    diff,
    wholeFile: fullContext,
  });
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(
    null,
  );
  const composer = useLineComposer({
    path: file.filename,
    drafts: progress.drafts,
    addDraft: actions.addDraft,
    removeDraft: actions.removeDraft,
    onSaved: () => setSelection(null),
  });
  const open = composer.composer;
  const revision = revisionOf(pull);
  const theme = useTheme();
  const syntaxThemes = useSyntaxThemes();
  const [highlightLarge, setHighlightLarge] = useState(false);
  const isLarge =
    !!diff &&
    Math.max(diff.additionLines.length, diff.deletionLines.length) > 5000;
  const annotations = useMemo(
    () =>
      lineAnnotations({
        path: file.filename,
        head: pull.head.sha,
        revision,
        comments,
        drafts: progress.drafts,
        marks: progress.marks,
        diagnostics: aligned ? diagnostics : [],
        composer: open,
      }),
    [
      comments,
      progress,
      file.filename,
      revision,
      open,
      pull.head.sha,
      aligned,
      diagnostics,
    ],
  );
  const items = useMemo<CodeViewDiffItem<LineNotes>[]>(
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
          Open in {pullHostName(pull.html_url)}
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
    <div className="diff-wrapper" ref={frame} {...blame.handlers}>
      {find}
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
        <SelectionToolbar
          range={selection.range}
          path={file.filename}
          questionAgent={questionAgent}
          onAskAboutLines={onAskAboutLines}
          onDiscuss={onDiscuss}
          onComment={() => composer.begin(selection.range)}
          onEditLine={onEditLine}
          onMark={(start, end, side) => {
            onMark(start, end, side);
            setSelection(null);
          }}
          onClear={() => setSelection(null)}
          onError={onError}
        />
      )}
      <FileChecks
        checks={checks}
        checked={checked}
        aligned={aligned}
        diagnostics={diagnostics}
        onEditLine={onEditLine}
        onProblem={setProblemLine}
      />
      <DiffCodeView<LineNotes>
        viewerRef={viewer}
        className="diff-code-view"
        scrollPastEnd
        unsafeCSSExtra={`:host {color-scheme:${theme} !important;} [data-diff], [data-file] {transition:none !important; opacity:1 !important;}`}
        items={items}
        selectedLines={selection}
        onSelectedLinesChange={setSelection}
        options={{
          ...symbols.handlers,
          onLineClick: (line) => {
            const range = clickedLine(line);
            if (range) setSelection({ id: file.filename, range });
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
          onGutterUtilityClick: composer.begin,
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
          <LineAnnotations
            notes={a.metadata}
            path={file.filename}
            composer={composer}
            actions={noteActions}
          />
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
