import type { SelectedLineRange } from "@pierre/diffs";

/** The most lines a question or a comment can point at. */
const MAX_LINES = 200;

type Side = NonNullable<SelectedLineRange["side"]>;

/**
 * The line a plain click on code picks. A click on the gutter, with a
 * modifier, or ending a text selection is something else, so none.
 */
export function clickedLine(line: {
  event: MouseEvent;
  numberColumn: boolean;
  lineNumber: number;
  annotationSide?: Side;
}): SelectedLineRange | null {
  const { event } = line;
  if (
    line.numberColumn ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.defaultPrevented ||
    !window.getSelection()?.isCollapsed
  )
    return null;
  return {
    start: line.lineNumber,
    end: line.lineNumber,
    side: line.annotationSide ?? "additions",
  };
}

/** A selection as ordered lines on one side, or why it can't be one. */
export function selectedSpan(
  range: SelectedLineRange,
):
  | { side: Side; start: number; end: number }
  | { error: "two-sides" | "too-long" } {
  const side = range.side ?? "additions";
  if (range.endSide && range.endSide !== side) return { error: "two-sides" };
  const start = Math.min(range.start, range.end),
    end = Math.max(range.start, range.end);
  if (end - start >= MAX_LINES) return { error: "too-long" };
  return { side, start, end };
}
