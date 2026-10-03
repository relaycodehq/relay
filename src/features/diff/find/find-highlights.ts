import { DIFFS_TAG_NAME } from "@pierre/diffs";
import type { Side } from "../../../../shared/types";
import { lineKey, type FindMatch } from "./diff-find";

/**
 * Find marks are CSS custom highlights: ranges over the viewer's own text,
 * painted by `::highlight()` rules in its shadow stylesheet, so nothing is
 * added to the DOM the viewer recycles as it scrolls. Each open find bar
 * keeps its ranges here; the two named highlights hold everyone's.
 */
export const FIND_HIGHLIGHT = "relay-diff-find";
export const CURRENT_HIGHLIGHT = "relay-diff-find-current";

const owned = new Map<symbol, { all: Range[]; current: Range[] }>();

function publish() {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  const all = [...owned.values()].flatMap((o) => o.all);
  const current = [...owned.values()].flatMap((o) => o.current);
  if (all.length) CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...all));
  else CSS.highlights.delete(FIND_HIGHLIGHT);
  if (current.length)
    CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(...current));
  else CSS.highlights.delete(CURRENT_HIGHLIGHT);
}

export function setFindRanges(
  owner: symbol,
  ranges: { all: Range[]; current: Range[] } | null,
) {
  if (ranges) owned.set(owner, ranges);
  else if (!owned.delete(owner)) return;
  publish();
}

/** The viewer's shadow roots under `frame`, one per file it draws. */
export const viewerRoots = (frame: HTMLElement) =>
  Array.from(
    frame.querySelectorAll(DIFFS_TAG_NAME),
    (host) => host.shadowRoot,
  ).filter((root): root is ShadowRoot => !!root);

/** Which side and number a drawn code line stands for. */
function drawnLine(element: HTMLElement): [Side, number] | null {
  const line = Number(element.dataset.line);
  if (!line) return null;
  const column = element.closest("code");
  if (column?.hasAttribute("data-deletions")) return ["deletions", line];
  if (column?.hasAttribute("data-additions")) return ["additions", line];
  return element.dataset.lineType === "change-deletion"
    ? ["deletions", line]
    : ["additions", line];
}

/** A range over characters `start`–`end` of an element's text, across its token spans. */
function textRange(element: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (!started && start < offset + length) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}

/**
 * Scrolls a long line sideways to bring a match into view; the viewer's own
 * scrolling only moves between lines. The line numbers stick to the left
 * edge, so a match close to it counts as hidden too. `moved` keeps where each
 * scrolled line started, to put it back when the find closes.
 */
export function revealAcross(range: Range, moved: Map<HTMLElement, number>) {
  let scroller = range.startContainer.parentElement;
  while (
    scroller &&
    !(
      scroller.scrollWidth > scroller.clientWidth &&
      /auto|scroll/.test(getComputedStyle(scroller).overflowX)
    )
  )
    scroller = scroller.parentElement;
  if (!scroller) return;
  const match = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (match.left >= box.left + 64 && match.right <= box.right) return;
  if (!moved.has(scroller)) moved.set(scroller, scroller.scrollLeft);
  scroller.scrollLeft +=
    match.left + match.width / 2 - (box.left + box.width / 2);
}

/** Ranges for the matches on the lines the viewer has drawn right now. */
export function drawnRanges(
  frame: HTMLElement,
  matches: FindMatch[],
  byLine: Map<string, number[]>,
  current: number,
) {
  const all: Range[] = [];
  const now: Range[] = [];
  for (const root of viewerRoots(frame))
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-content] > [data-line]",
    )) {
      const drawn = drawnLine(element);
      const hits = drawn && byLine.get(lineKey(...drawn));
      if (!hits) continue;
      for (const index of hits) {
        const range = textRange(
          element,
          matches[index].start,
          matches[index].end,
        );
        if (range) (index === current ? now : all).push(range);
      }
    }
  return { all, current: now };
}
