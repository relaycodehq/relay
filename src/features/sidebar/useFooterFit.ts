import { useLayoutEffect, type RefObject } from "react";

/** How many steps sidebar.css can take, see the footer's "fit steps". */
const FIT_STEPS = 3;

/**
 * Sheds the sidebar footer one step at a time until it fits its width,
 * listing the steps taken in the row's `data-fit` ("1 2"): the version goes
 * first, then the agent update's words, then the word before the app
 * update's version. Every check starts again from the full row, so widening
 * gives them back.
 */
export function useFooterFit(row: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    // The row is packed to its end, so what doesn't fit spills off its start,
    // where nothing scrolls: scrollWidth can't tell, the items' widths can.
    const fits = () => {
      const style = getComputedStyle(el);
      const items = [
        ...el.querySelectorAll<HTMLElement>(
          ":scope > :not([data-base-ui-focus-guard])",
        ),
      ].filter((item) => item.offsetWidth > 0);
      const used =
        items.reduce(
          (sum, item) => sum + item.getBoundingClientRect().width,
          0,
        ) +
        (parseFloat(style.columnGap) || 0) * Math.max(0, items.length - 1);
      const room =
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      return used <= room + 0.5;
    };
    let fitting = false;
    const fit = () => {
      if (fitting) return;
      fitting = true;
      const taken: number[] = [];
      el.dataset.fit = "";
      while (taken.length < FIT_STEPS && !fits()) {
        taken.push(taken.length + 1);
        el.dataset.fit = taken.join(" ");
      }
      fitting = false;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(el);
    // An update button showing up or relabelling doesn't resize the row.
    const changes = new MutationObserver(fit);
    changes.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      resize.disconnect();
      changes.disconnect();
    };
  }, [row]);
}
