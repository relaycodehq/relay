/** How tall a line is on the minimap, in px: as tall as fits the whole file on it, within these. */
const LINE_PX = { most: 2, least: 0.6 };

/** A line's height on a minimap `mapHeight` px tall: the whole file when it fits, else as dense as is still legible. */
export function mapLineHeight(lines: number, mapHeight: number) {
  return Math.min(LINE_PX.most, Math.max(LINE_PX.least, mapHeight / Math.max(lines, 1)));
}

/**
 * Which lines the minimap shows and where the screen's slider sits on it.
 * A file too long for the minimap scrolls under it in step with the editor,
 * as VS Code's does: at the top of the file its first lines, at the bottom
 * its last.
 */
export function minimapWindow({
  lines,
  mapHeight,
  lineHeight,
  scrolled,
  topLine,
  bottomLine,
}: {
  lines: number;
  mapHeight: number;
  lineHeight: number;
  /** How far down the editor is scrolled, 0 to 1. */
  scrolled: number;
  /** The first and last line on screen, 1-based. */
  topLine: number;
  bottomLine: number;
}) {
  const overflow = Math.max(0, lines * lineHeight - mapHeight);
  const offset = Math.round(overflow * Math.min(Math.max(scrolled, 0), 1));
  const firstLine = Math.floor(offset / lineHeight) + 1;
  const lastLine = Math.min(lines, Math.ceil((offset + mapHeight) / lineHeight));
  return {
    offset,
    firstLine,
    lastLine,
    lineHeight,
    sliderTop: (topLine - 1) * lineHeight - offset,
    sliderHeight: Math.max((bottomLine - topLine + 1) * lineHeight, 4),
  };
}

/** The line under a point `y` px down the minimap. */
export function lineAtMinimap(y: number, offset: number, lineHeight: number, lines: number) {
  return Math.min(Math.max(Math.floor((y + offset) / lineHeight) + 1, 1), lines);
}

/** A run of lines painted at once: the page's lines and a page's worth either side, so scrolling slides it rather than repainting. */
export type Band = { first: number; last: number };

/** The band to paint around the lines the page shows now. */
export function bandAround(firstLine: number, lastLine: number, lines: number): Band {
  const page = lastLine - firstLine + 1;
  return { first: Math.max(1, firstLine - page), last: Math.min(lines, lastLine + page) };
}

/** Whether a painted band still holds every line the page shows. */
export const bandHolds = (band: Band, firstLine: number, lastLine: number) =>
  band.first <= firstLine && band.last >= lastLine;
