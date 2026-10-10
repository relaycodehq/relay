import type { CSSProperties } from "react";
import { dragFrom } from "../lib/dragFrom";
import "./splitter.css";

/**
 * A handle between two areas that resizes them by drag, arrow keys or a
 * double-click back to the default. `begin` reads where things stand when a
 * drag or key press starts, measuring from the handle if it needs to, and
 * returns what to do with how far it went: positive is right or down.
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
  begin: (handle: HTMLElement) => (delta: number) => void;
  onReset: () => void;
}) {
  const vertical = orientation === "vertical";
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
        begin(e.currentTarget)(e.key === back ? -step : step);
      }}
      onPointerDown={(e) => {
        const move = begin(e.currentTarget);
        dragFrom(e, (dx, dy) => move(vertical ? dx : dy));
      }}
    />
  );
}
