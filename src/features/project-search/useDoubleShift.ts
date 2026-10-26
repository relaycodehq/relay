import { useEffect } from "react";
import { useStableCallback } from "../../lib/useStableCallback";

/** Longest the second Shift may come after the first. */
export const doubleShiftMs = 300;

/**
 * Tells a double tap of Shift from typing capitals or Shift-clicking: two
 * presses, released in between, with no other key or click on the way. Held
 * and repeated keys, a Shift with another modifier, and IME composition
 * never count.
 */
export function doubleShiftDetector(
  fire: () => void,
  now: () => number = Date.now,
  windowMs = doubleShiftMs,
) {
  let firstAt = 0;
  let released = false;
  const reset = () => {
    firstAt = 0;
    released = false;
  };
  return {
    keydown(e: KeyboardEvent) {
      if (e.isComposing) return reset();
      if (e.key !== "Shift") return reset();
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return reset();
      const at = now();
      if (firstAt && released && at - firstAt <= windowMs) {
        reset();
        fire();
      } else {
        firstAt = at;
        released = false;
      }
    },
    keyup(e: KeyboardEvent) {
      // Shift is still down when the other one lets go; that is no release.
      if (e.key === "Shift" && !e.shiftKey && firstAt) released = true;
    },
    reset,
  };
}

/**
 * Calls `onDouble` when Shift is pressed twice quickly. Listens before the
 * page's other handlers, so an editor that handles keys itself can't hide it.
 */
export function useDoubleShift(onDouble: () => void, enabled = true) {
  const fire = useStableCallback(onDouble);
  useEffect(() => {
    if (!enabled) return;
    const detector = doubleShiftDetector(fire);
    const down = (e: KeyboardEvent) => detector.keydown(e);
    const up = (e: KeyboardEvent) => detector.keyup(e);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    // A click between the taps, or leaving the window, ends the chance.
    window.addEventListener("pointerdown", detector.reset, true);
    window.addEventListener("blur", detector.reset);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", detector.reset, true);
      window.removeEventListener("blur", detector.reset);
    };
  }, [enabled, fire]);
}
