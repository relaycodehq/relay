import type { RefObject } from "react";
import { useFitSteps } from "../../lib/useFitSteps";

/** How many steps composer.css can take, see its "fit steps". */
const FIT_STEPS = 6;

/**
 * Sheds the toolbar's labels until the controls and the end group (send,
 * stop, mic) share one line. Past the last step the row wraps as before.
 */
export function useToolbarFit(row: RefObject<HTMLElement | null>) {
  useFitSteps(row, FIT_STEPS, oneLine);
}

function oneLine(el: HTMLElement) {
  const end = el.querySelector<HTMLElement>(":scope > .composer-tools-end");
  // An open popover puts a fixed-position focus guard before its trigger,
  // which would read as the row's first control.
  const first = el.querySelector<HTMLElement>(
    ":scope > :not(input, .composer-tools-end, [data-base-ui-focus-guard])",
  );
  // A pixel or two of baseline difference isn't a wrap.
  return !end || !first || end.offsetTop < first.offsetTop + 8;
}
