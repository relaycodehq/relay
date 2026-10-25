import type { CSSProperties } from "react";
import { dragFrom } from "../lib/dragFrom";
import "./splitter.css";

type Move = (delta: number) => void;

/**
 * A handle between two areas that resizes them by drag, arrow keys or a
 * double-click back to the default. `begin` reads where things stand when a
 * drag or key press starts, measuring from the handle if it needs to, and
 * returns what to do with how far it went: positive is right or down. It can
 * return an `end` too, which runs once the drag lets go or the key press is
 * done, for a resize that's only shown while it moves and kept at the end.
 */
export function Splitter({
  label,
  className,
  orientation = "vertical",
  step = 10,
  value,
  min,
  max,
  style,
  begin,
  onReset,
}: {
  label: string;
  /** Places the handle; the base class gives it its cursor and focus ring. */
  className: string;
  /** `vertical` is a handle between areas side by side. */
  orientation?: "vertical" | "horizontal";
  /** How far one arrow press moves it, in pixels. */
  step?: number;
  value?: number;
  min?: number;
  max?: number;
  style?: CSSProperties;
  begin: (handle: HTMLElement) => Move | { move: Move; end: () => void };
  onReset: () => void;
}) {
  const vertical = orientation === "vertical";
  const start = (handle: HTMLElement) => {
    const drag = begin(handle);
    return typeof drag === "function" ? { move: drag, end: undefined } : drag;
  };
  return (
    <div
      className={`splitter ${vertical ? "" : "horizontal"} ${className}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      style={style}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const back = vertical ? "ArrowLeft" : "ArrowUp",
          forward = vertical ? "ArrowRight" : "ArrowDown";
        if (e.key !== back && e.key !== forward) return;
        e.preventDefault();
        const { move, end } = start(e.currentTarget);
        move(e.key === back ? -step : step);
        end?.();
      }}
      onPointerDown={(e) => {
        const { move, end } = start(e.currentTarget);
        dragFrom(e, (dx, dy) => move(vertical ? dx : dy), end);
      }}
    />
  );
}
