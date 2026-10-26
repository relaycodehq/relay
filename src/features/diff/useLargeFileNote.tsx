import { useState, type ReactNode } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { HIGHLIGHT_MAX_LINES } from "./highlighting";

const LARGE_TOKENIZE_MAX = 100000;

/**
 * A diff past the highlighting limit shows as plain text until the reader
 * asks for colour: the note that offers it, and the limit the viewer tokenizes to.
 */
export function useLargeFileNote(diff: FileDiffMetadata | undefined) {
  const [highlightLarge, setHighlightLarge] = useState(false);
  const isLarge =
    !!diff &&
    Math.max(diff.additionLines.length, diff.deletionLines.length) >
      HIGHLIGHT_MAX_LINES;
  const note: ReactNode = isLarge && !highlightLarge && (
    <div className="large-file-note">
      <span>Large file · fast text view keeps memory low</span>
      <button onClick={() => setHighlightLarge(true)}>
        Enable syntax highlighting
      </button>
    </div>
  );

  return {
    note,
    tokenizeMaxLength: highlightLarge
      ? LARGE_TOKENIZE_MAX
      : HIGHLIGHT_MAX_LINES,
  };
}
