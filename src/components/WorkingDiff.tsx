import { useEffect, useMemo, useRef, useState } from "react";
import { persistedStore } from "../lib/persisted-store";
import { useElementWidth } from "../lib/useElementWidth";
import type {
  CodeViewDiffItem,
  CodeViewLineSelection,
  SelectedLineRange,
} from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { clickedLine, selectedSpan } from "../lib/diff-selection";
import { Columns2, MessageSquare, X } from "lucide-react";
import type { FilePair, Side } from "../../shared/types";
import { StyledDiffCodeView } from "../vendor/t3code/StyledDiffCodeView";
import { useFileDiff } from "../lib/useFileDiff";
import { useTheme } from "../lib/useTheme";
import { useSyntaxThemes } from "../lib/appearance";
import { labelDiffGapControls } from "../lib/diffGapControls";
import { useTypography } from "../lib/typography";
import { ErrorBox, IconButton, Loading } from "./ui";
import { ImageDiff } from "./ImageDiff";
export interface WorkingLineTarget {
  side: Side;
  start: number;
  end: number;
  /** The selected source lines, from the side they were picked on. */
  code: string;
}
type Viewer = CodeViewHandle<undefined, undefined>;
const splitDiff = persistedStore(
  "relay-diff-split",
  (saved) => saved !== "false",
  (split) => String(split),
);
/** Side-by-side or inline diffs, shared by every diff and kept across restarts. */
export const useSplitDiff = () => [splitDiff.use(), splitDiff.set] as const;
export function SplitDiffToggle({
  split,
  onChange,
}: {
  split: boolean;
  onChange: (split: boolean) => void;
}) {
  return (
    <IconButton
      label="Side-by-side diff"
      active={split}
      onClick={() => onChange(!split)}
    >
      <Columns2 size={14} />
    </IconButton>
  );
}
export function WorkingDiff({
  pair,
  sideLabels,
  split = true,
  onAsk,
  line,
  onLineShown,
}: {
  pair: FilePair;
  sideLabels?: Record<Side, string>;
  split?: boolean;
  onAsk?: (target: WorkingLineTarget) => void;
  /** A line of the new side to scroll to once the diff renders. */
  line?: number;
  onLineShown?: () => void;
}) {
  const syntaxThemes = useSyntaxThemes();
  const { wrap } = useTypography();
  const theme = useTheme(),
    { diff, error } = useFileDiff(pair),
    [selection, setSelection] = useState<CodeViewLineSelection | null>(null),
    [selectionError, setSelectionError] = useState("");
  // Side-by-side needs room; narrow panes read better as a unified diff.
  const frame = useRef<HTMLDivElement>(null),
    width = useElementWidth(frame);
  // The viewer mounts once the syntax workers are ready, after the diff.
  const [viewer, setViewer] = useState<Viewer | null>(null);
  useEffect(() => setSelection(null), [pair]);
  const items = useMemo<CodeViewDiffItem[]>(
    () => (diff ? [{ id: "working", type: "diff", fileDiff: diff }] : []),
    [diff],
  );
  // A line hidden in unchanged code scrolls to the fold that holds it.
  useEffect(() => {
    if (!line || !viewer) return;
    const request = requestAnimationFrame(() => {
      viewer.scrollTo({
        type: "line",
        id: "working",
        lineNumber: line,
        side: "additions",
        align: "center",
      });
      onLineShown?.();
    });
    return () => cancelAnimationFrame(request);
  }, [line, viewer, diff]);
  const ask = (range: SelectedLineRange | null) => {
    if (!range || !onAsk) return;
    const span = selectedSpan(range);
    if ("error" in span) {
      setSelectionError(
        span.error === "two-sides"
          ? "Select lines on one side to ask about them."
          : "Select up to 200 lines to ask about them.",
      );
      return;
    }
    const { side, start, end } = span;
    const source = side === "deletions" ? pair.old : pair.next;
    const code = (source?.contents ?? "")
      .split(/\r?\n/)
      .slice(start - 1, end)
      .join("\n");
    onAsk({ side, start, end, code });
    setSelection(null);
  };
  const body = (() => {
    if (pair.images)
      return (
        <ImageDiff
          images={pair.images}
          sideLabels={sideLabels}
          split={split && !(width && width < 480)}
        />
      );
    if (pair.binary)
      return (
        <div className="empty small">
          Binary file. Review it in its native application.
        </div>
      );
    if (error) return <ErrorBox error={error} />;
    if (!diff) return <Loading text="Loading local diff…" />;
    if (!diff.hunks.length)
      return (
        <div className="empty small">
          No text changes. This may be a file mode change or an empty file.
        </div>
      );
    return (
      <StyledDiffCodeView
        className="working-diff"
        scrollPastEnd
        viewerRef={setViewer}
        items={items}
        selectedLines={onAsk ? selection : undefined}
        onSelectedLinesChange={(next) => {
          setSelectionError("");
          setSelection(next);
        }}
        options={{
          ...(onAsk && {
            enableLineSelection: true,
            enableGutterUtility: true,
            onGutterUtilityClick: ask,
            onLineClick: (line) => {
              const range = clickedLine(line);
              if (!range) return;
              setSelectionError("");
              setSelection({ id: "working", range });
            },
          }),
          theme: syntaxThemes,
          themeType: theme,
          preferredHighlighter: "shiki-js",
          diffStyle: split && !(width && width < 480) ? "split" : "unified",
          disableFileHeader: true,
          hunkSeparators: "line-info",
          expansionLineCount: 20,
          tokenizeMaxLength: 5000,
          tokenizeMaxLineLength: 1000,
          maxLineDiffLength: 1000,
          overflow: wrap ? "wrap" : "scroll",
          onPostRender: (node, _instance, phase) => {
            if (phase !== "unmount") labelDiffGapControls(node);
          },
        }}
      />
    );
  })();
  return (
    <div className="working-diff-frame" ref={frame}>
      {onAsk && selection && (
        <div className="selection-toolbar">
          <span>
            {selectionError ||
              `${sideLabels?.[selection.range.side ?? "additions"] ?? ""} · ${
                selection.range.start === selection.range.end
                  ? `line ${selection.range.start}`
                  : `lines ${Math.min(selection.range.start, selection.range.end)}–${Math.max(selection.range.start, selection.range.end)}`
              }`}
          </span>
          <button onClick={() => ask(selection.range)}>
            <MessageSquare size={13} /> Ask in chat
          </button>
          <IconButton
            label="Clear selected lines"
            onClick={() => setSelection(null)}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {body}
    </div>
  );
}
