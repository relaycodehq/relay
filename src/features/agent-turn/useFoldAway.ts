import { useLayoutEffect, useRef, useState } from "react";
import { foldAway, foldMs } from "../../lib/fold-motion";

/**
 * Keeps a turn's trace mounted while it folds away, once `expanded` turns
 * false: a turn that ends folds its trace instead of dropping it in one frame.
 * The ref goes on what folds. A reader's click closes the <details> at once,
 * so there the fold plays hidden.
 */
export function useFoldAway(expanded: boolean) {
  const [shown, setShown] = useState(expanded);
  const [folding, setFolding] = useState(false);
  if (shown !== expanded) {
    setShown(expanded);
    setFolding(!expanded);
  }
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!folding) return;
    const animation = ref.current && foldAway(ref.current);
    if (!animation) {
      setFolding(false);
      return;
    }
    // Not on `finished` alone: an animation that never plays never finishes.
    const done = () => setFolding(false);
    animation.finished.then(done, () => {});
    const backstop = setTimeout(done, foldMs + 100);
    return () => {
      clearTimeout(backstop);
      animation.cancel();
    };
  }, [folding]);
  return { folding, ref };
}
