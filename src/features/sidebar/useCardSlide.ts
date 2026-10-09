import { useEffect, useLayoutEffect, useRef } from "react";
import { reducedMotion, slideRow } from "../../lib/slide-row";

/**
 * Slides Activity's cards (`data-card`) to their new places whenever a
 * render moves them, from where they showed, even partway through a slide.
 * Places are layout offsets within the list, so scrolling moves nothing.
 */
export function useCardSlide() {
  const list = useRef<HTMLDivElement>(null);
  const placed = useRef(new Map<string, number>());
  const running = useRef(new Map<HTMLElement, Animation>());

  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const base = layoutTop(root);
    const was = placed.current;
    const now = new Map<string, number>();
    const still = reducedMotion();
    for (const row of root.querySelectorAll<HTMLElement>("[data-card]")) {
      const to = layoutTop(row) - base;
      now.set(row.dataset.card!, to);
      const from = was.get(row.dataset.card!);
      // A card that kept its place goes on with any slide it's in.
      if (from === undefined || still || Math.abs(from - to) < 1) continue;
      const prior = running.current.get(row);
      const shown = from + (prior ? translateY(row) : 0);
      prior?.cancel();
      // React moves a card by taking it out and back in, which replays its entrance.
      for (const entrance of row.getAnimations())
        if (entrance instanceof CSSAnimation) entrance.finish();
      // The card rising is the one something happened to; it passes over.
      const animation = slideRow(row, shown - to, shown > to);
      running.current.set(row, animation);
      animation.addEventListener("finish", () => running.current.delete(row));
    }
    placed.current = now;
  });

  useEffect(
    () => () => {
      running.current.forEach((animation) => animation.cancel());
      running.current.clear();
    },
    [],
  );

  return list;
}

/** Where `el` sits in the page by layout alone, without transforms or scrolling. */
function layoutTop(el: HTMLElement) {
  let top = 0;
  for (
    let at: Element | null = el;
    at instanceof HTMLElement;
    at = at.offsetParent
  )
    top += at.offsetTop;
  return top;
}

function translateY(el: HTMLElement) {
  const transform = getComputedStyle(el).transform;
  return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
}
