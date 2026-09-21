import { parseDiffFromFile } from "@pierre/diffs";
import type { FilePair } from "../../shared/types";
self.onmessage = (event: MessageEvent<FilePair & { editable?: boolean }>) => {
  try {
    const { old, next } = event.data;
    const value = parseDiffFromFile(old, next, { context: 4 }, true);
    // Identical files have no patch hunks, but an editor still needs a text surface.
    if (event.data.editable && !value.hunks.length && next) {
      const count = Math.max(1, value.additionLines.length);
      if (!value.additionLines.length) value.additionLines = [""];
      if (!value.deletionLines.length) value.deletionLines = [""];
      const noEOF = !!next.contents && !next.contents.endsWith("\n");
      value.splitLineCount = value.unifiedLineCount = count;
      value.hunks = [
        {
          collapsedBefore: 0,
          additionStart: 1,
          deletionStart: 1,
          additionCount: count,
          deletionCount: count,
          additionLines: 0,
          deletionLines: 0,
          additionLineIndex: 0,
          deletionLineIndex: 0,
          splitLineStart: 0,
          unifiedLineStart: 0,
          splitLineCount: count,
          unifiedLineCount: count,
          noEOFCRAdditions: noEOF,
          noEOFCRDeletions: noEOF,
          hunkContent: [
            {
              type: "context",
              lines: count,
              additionLineIndex: 0,
              deletionLineIndex: 0,
            },
          ],
        },
      ];
    }
    self.postMessage({ value });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Could not compute diff.",
    });
  }
};
