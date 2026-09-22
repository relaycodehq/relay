import { useEffect, useMemo, useState } from "react";
import type { CodeViewDiffItem, FileDiffMetadata } from "@pierre/diffs";
import type { FilePair } from "../../shared/types";
import { StyledDiffCodeView } from "../vendor/t3code/StyledDiffCodeView";
import DiffWorker from "../lib/diff.worker?worker";
import { useTheme } from "../lib/useTheme";
import { labelDiffGapControls } from "../lib/diffGapControls";
import { ErrorBox, Loading } from "./ui";
export function WorkingDiff({ pair }: { pair: FilePair }) {
  const theme = useTheme(),
    [diff, setDiff] = useState<FileDiffMetadata | null>(null),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    setDiff(null);
    setError(undefined);
    if (pair.binary) return;
    const worker = new DiffWorker();
    worker.onmessage = (e) => {
      if (e.data.error) setError(e.data.error);
      else setDiff(e.data.value);
    };
    worker.onerror = (e) => setError(e.message);
    worker.postMessage(pair);
    return () => worker.terminate();
  }, [pair]);
  const items = useMemo<CodeViewDiffItem[]>(
    () => (diff ? [{ id: "working", type: "diff", fileDiff: diff }] : []),
    [diff],
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
      items={items}
      options={{
        theme: { light: "pierre-light", dark: "pierre-dark" },
        themeType: theme,
        preferredHighlighter: "shiki-js",
        diffStyle: "split",
        disableFileHeader: true,
        hunkSeparators: "line-info",
        expansionLineCount: 20,
        tokenizeMaxLength: 5000,
        tokenizeMaxLineLength: 1000,
        maxLineDiffLength: 1000,
        overflow: "scroll",
        onPostRender: (node, _instance, phase) => {
          if (phase !== "unmount") labelDiffGapControls(node);
        },
      }}
    />
  );
}
