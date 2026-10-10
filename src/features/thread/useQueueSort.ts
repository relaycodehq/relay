import { useLayoutEffect, useRef, type PointerEvent } from "react";
import type { QueueDrop } from "./chat-queue";

/** How far the pointer moves before a press becomes a drag, so clicks still expand a message. */
const DRAG_THRESHOLD = 4;
/** How long the dropped row takes to glide into its slot. */
const SETTLE_MS = 160;

/** Clears what a drag left on the rows, without animating them back. */
function settle(list: HTMLElement | null) {
  if (!list) return;
  // Leaves the rows of a drag in progress alone.
  if (list.querySelector(":scope > .lifted")) return;
  list.classList.remove("sorting");
  const rows = [...list.children] as HTMLElement[];
  for (const row of rows) {
    row.classList.remove("lifted");
    row.style.transition = "none";
    row.style.transform = "";
  }
  void list.offsetHeight;
  for (const row of rows) row.style.transition = "";
}

/**
 * Reorders a list by dragging with the pointer: the picked row follows it,
 * the rows it passes slide aside, and the drop becomes a `QueueDrop`. The
 * rows stay where they slid until the reordered list renders, so nothing
 * snaps back for a frame in between.
 */
export function useQueueSort(
  ids: string[],
  enabled: boolean,
  onMove: (id: string, target: QueueDrop) => void,
) {
  const list = useRef<HTMLOListElement>(null);
  const dropped = useRef(false);
  const order = ids.join("\n");
  useLayoutEffect(() => settle(list.current), [order]);

  function onPointerDown(e: PointerEvent<HTMLOListElement>) {
    const root = list.current,
      target = e.target as Element;
    if (!enabled || !root || e.button !== 0 || target.closest("button, a"))
      return;
    const rows = [...root.children] as HTMLElement[];
    const from = rows.findIndex((row) => row.contains(target));
    if (from < 0 || rows.length < 2) return;
    // Keeps the composer focused and the text unselected, as the buttons do.
    e.preventDefault();
    const row = rows[from],
      y0 = e.clientY,
      boxes = rows.map((r) => r.getBoundingClientRect()),
      gap = boxes[1].top - boxes[0].bottom,
      step = boxes[from].height + gap;
    let dragging = false,
      to = from;

    const move = (ev: globalThis.PointerEvent) => {
      const dy = ev.clientY - y0;
      if (!dragging) {
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        row.classList.add("lifted");
        root.classList.add("sorting");
      }
      const d = Math.max(
        boxes[0].top - boxes[from].top - 8,
        Math.min(boxes[boxes.length - 1].bottom - boxes[from].bottom + 8, dy),
      );
      row.style.transform = `translateY(${d}px)`;
      const middle = boxes[from].top + boxes[from].height / 2 + d;
      to = from;
      boxes.forEach((box, i) => {
        const m = box.top + box.height / 2;
        if (i < from && middle < m) to = Math.min(to, i);
        if (i > from && middle > m) to = Math.max(to, i);
      });
      rows.forEach((other, i) => {
        if (i === from) return;
        const shift =
          from < to && i > from && i <= to
            ? -step
            : from > to && i >= to && i < from
              ? step
              : 0;
        other.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    const end = (cancelled: boolean) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      if (!dragging) return;
      dropped.current = true;
      setTimeout(() => (dropped.current = false));
      if (cancelled) to = from;
      const offset =
        to > from
          ? boxes[to].bottom - boxes[from].bottom
          : to < from
            ? boxes[to].top - boxes[from].top
            : 0;
      row.classList.remove("lifted");
      row.style.transition = `transform ${SETTLE_MS}ms ease`;
      row.style.transform = offset ? `translateY(${offset}px)` : "";
      if (to === from) {
        rows.forEach((other) => (other.style.transform = ""));
        setTimeout(() => settle(root), SETTLE_MS);
        return;
      }
      setTimeout(() => {
        onMove(ids[from], {
          id: ids[to],
          where: to > from ? "after" : "before",
        });
        // The move may come to nothing; don't leave the rows slid.
        setTimeout(() => settle(root), 1000);
      }, SETTLE_MS);
    };
    const up = () => end(false);
    const cancel = () => end(true);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
  }

  return {
    list,
    onPointerDown,
    /** True for the click that ends a drag, so it doesn't also expand the message. */
    justDropped: () => dropped.current,
  };
}
