import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Starts a drag from a splitter's pointer-down. `move` hears how far the
 * pointer has travelled from where it went down, and `done` runs when it lets go.
 */
export function dragFrom(
  e: ReactPointerEvent<HTMLElement>,
  move: (dx: number, dy: number) => void,
  done?: () => void,
) {
  e.preventDefault();
  const element = e.currentTarget;
  const x = e.clientX,
    y = e.clientY;
  element.setPointerCapture(e.pointerId);
  const onMove = (event: PointerEvent) =>
    move(event.clientX - x, event.clientY - y);
  const stop = () => {
    element.removeEventListener("pointermove", onMove);
    element.removeEventListener("pointerup", stop);
    element.removeEventListener("pointercancel", stop);
    done?.();
  };
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
}
