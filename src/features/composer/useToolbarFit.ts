import { useLayoutEffect, type RefObject } from "react";

/** How many steps composer.css can take, see its "fit steps". */
export const FIT_STEPS = 6;

/**
 * Sheds the toolbar's labels one step at a time until the controls and the
 * end group (send, stop, mic) share one line, listing the steps taken in
 * the row's `data-fit` ("1 2 3"). Every check starts again from full labels, so widening gives
 * them back. Past the last step the row wraps as before.
 */
export function useToolbarFit(row: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const oneLine = () => {
      const end = el.querySelector<HTMLElement>(":scope > .composer-tools-end");
      const first = el.querySelector<HTMLElement>(
        ":scope > :not(input, .composer-tools-end)",
      );
      // A pixel or two of baseline difference isn't a wrap.
      return !end || !first || end.offsetTop < first.offsetTop + 8;
    };
    let fitting = false;
    const fit = () => {
      if (fitting) return;
      fitting = true;
      const taken: number[] = [];
      el.dataset.fit = "";
      while (taken.length < FIT_STEPS && !oneLine()) {
        taken.push(taken.length + 1);
        el.dataset.fit = taken.join(" ");
      }
      fitting = false;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(el);
    // A longer model name or Stop showing up doesn't resize the row while
    // it still fits on one line, so changes inside it check again.
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
