import { useEffect, useRef, useState, type RefObject } from "react";
import { popupOpen } from "../lib/shortcuts";

/** How close to the activity bar's right edge the pointer peeks a hidden sidebar. */
const EDGE_PEEK_WIDTH = 12;

/** The row's content edge, right of the activity bar that sits in its padding. */
function edgeStart(layout: HTMLElement | null) {
  if (!layout) return 0;
  const padding = parseFloat(getComputedStyle(layout).paddingLeft);
  return layout.getBoundingClientRect().left + padding;
}

const onEdge = (x: number, start: number) =>
  x >= start && x <= start + EDGE_PEEK_WIDTH;

/**
 * The hidden sidebar's peek: hovering its toggle or the window's left edge
 * slides it out as an overlay, and leaving it slides it back.
 */
export function useSidebarPeek(hidden: boolean, layout: HTMLElement | null) {
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const peekOpen = () => {
    window.clearTimeout(peekTimer.current);
    if (hidden) setPeek(true);
  };
  const peekClose = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), 250);
  };
  /** Ends it at once, as the sidebar is toggled. */
  const end = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(false);
  };
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  const asideRef = useRef<HTMLElement>(null);
  useEdgePeek({ hidden, peek, setPeek, peekClose, layout, asideRef });
  return { shown: peek, open: peekOpen, close: peekClose, end, asideRef };
}

/**
 * Resting the pointer along the activity bar's right edge peeks the hidden
 * sidebar too. It's watched rather than covered, so the edge still takes
 * clicks and selections; the short dwell keeps a pointer flung past it, or a
 * drag, from opening it.
 */
function useEdgePeek({
  hidden,
  peek,
  setPeek,
  peekClose,
  layout,
  asideRef,
}: {
  hidden: boolean;
  peek: boolean;
  setPeek: (peek: boolean) => void;
  peekClose: () => void;
  layout: HTMLElement | null;
  asideRef: RefObject<HTMLElement | null>;
}) {
  const edgePeekOn = hidden && !peek;
  useEffect(() => {
    if (!edgePeekOn) return;
    let timer: number | undefined;
    const start = edgeStart(layout);
    const cancel = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const onMove = (e: MouseEvent) => {
      const top = layout?.getBoundingClientRect().top ?? 0;
      if (e.buttons || !onEdge(e.clientX, start) || e.clientY < top)
        return cancel();
      timer ??= window.setTimeout(() => {
        if (popupOpen()) return;
        peekFromEdge.current = true;
        setPeek(true);
      }, 150);
    };
    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", cancel);
    return () => {
      cancel();
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", cancel);
    };
  }, [edgePeekOn, layout]);
  // The sidebar slides in under a pointer that hasn't entered it, so its own
  // mouseleave can't close it; until the pointer gets in, leaving the edge does.
  const peekFromEdge = useRef(false);
  useEffect(() => {
    if (!peek || !peekFromEdge.current) return;
    peekFromEdge.current = false;
    const start = edgeStart(layout);
    const onMove = (e: MouseEvent) => {
      const inside =
        e.target instanceof Node && asideRef.current?.contains(e.target);
      if (!inside && onEdge(e.clientX, start)) return;
      if (!inside) peekClose();
      window.removeEventListener("mousemove", onMove);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [peek]);
}
