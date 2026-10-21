import { useLayoutEffect, type RefObject } from "react";

/**
 * Sheds a row's contents one CSS step at a time until `fits` says it does,
 * listing the steps taken in the row's `data-fit` ("1 2 3"). Every check
 * starts again from the full row, so widening gives the steps back.
 */
export function useFitSteps(
  row: RefObject<HTMLElement | null>,
  steps: number,
  fits: (row: HTMLElement) => boolean,
) {
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    let fitting = false;
    const fit = () => {
      if (fitting) return;
      fitting = true;
      const taken: number[] = [];
      el.dataset.fit = "";
      while (taken.length < steps && !fits(el)) {
        taken.push(taken.length + 1);
        el.dataset.fit = taken.join(" ");
      }
      fitting = false;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(el);
    // A button showing up or relabelling doesn't resize a row that still fits.
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
  }, [row, steps, fits]);
}
