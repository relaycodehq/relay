import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Marks a thread title `data-cut` while it's too long for its row, so only a
 * cut-off title fades out at its end; one that fits keeps its last letters.
 * Returns the ref for the title.
 */
export function useTitleFade(title: string) {
  const el = useRef<HTMLElement | null>(null);
  const measured = useRef(title);
  // A new title can be longer or shorter without the row changing size. The
  // first one is left to the observer, which measures every new title in one
  // batch; measuring each here would lay the sidebar out once per title.
  useLayoutEffect(() => {
    if (title === measured.current) return;
    measured.current = title;
    if (el.current) mark([el.current]);
  }, [title]);
  return useCallback((node: HTMLElement | null) => {
    if (!node) return;
    el.current = node;
    observer().observe(node);
    return () => {
      observer().unobserve(node);
      el.current = null;
    };
  }, []);
}

// Measure every title before marking any, so a sidebar resize lays out once.
function mark(titles: HTMLElement[]) {
  const cut = titles.map((t) => t.scrollWidth > t.clientWidth);
  titles.forEach((t, i) => t.toggleAttribute("data-cut", cut[i]));
}

// One observer for every title; it also reports each one as it's first observed.
let shared: ResizeObserver | undefined;
const observer = () =>
  (shared ??= new ResizeObserver((entries) =>
    mark(entries.map((e) => e.target as HTMLElement)),
  ));
