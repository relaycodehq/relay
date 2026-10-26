import { useLayoutEffect, useRef, type RefObject } from "react";
import { growIn } from "../../lib/fold-motion";

/**
 * What an answer gains as its turn ends, like the changed files or the image
 * strip, opens in instead of pushing the answer up in one frame. Only a turn
 * seen running: a thread opened later shows them as they are.
 */
export function useEndGrowsIn(answer: RefObject<HTMLElement | null>, live: boolean) {
  const before = useRef(new Set<Element>());
  const wasLive = useRef(live);
  useLayoutEffect(() => {
    const children = [...(answer.current?.children ?? [])];
    const ended = wasLive.current && !live;
    wasLive.current = live;
    if (ended)
      for (const child of children)
        if (!before.current.has(child) && child instanceof HTMLElement) growIn(child);
    before.current = new Set(children);
  });
}
