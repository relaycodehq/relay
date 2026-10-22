import type { RefObject } from "react";
import { useFitSteps } from "../../lib/useFitSteps";

/** How many steps sidebar.css can take, see the footer's "fit steps". */
const FIT_STEPS = 1;

/** Sheds the sidebar footer until it fits its width: the version goes first. */
export function useFooterFit(row: RefObject<HTMLElement | null>) {
  useFitSteps(row, FIT_STEPS, fits);
}

// The row is packed to its end, so what doesn't fit spills off its start,
// where nothing scrolls: scrollWidth can't tell, the items' widths can.
function fits(el: HTMLElement) {
  const style = getComputedStyle(el);
  const items = [
    ...el.querySelectorAll<HTMLElement>(
      ":scope > :not([data-base-ui-focus-guard])",
    ),
  ].filter((item) => item.offsetWidth > 0);
  const used =
    items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) +
    (parseFloat(style.columnGap) || 0) * Math.max(0, items.length - 1);
  const room =
    el.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  return used <= room + 0.5;
}
