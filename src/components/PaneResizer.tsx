import { useState } from "react";
export function PaneResizer({
  pane,
  label,
  initial,
  min,
  max,
}: {
  pane: "sidebar" | "inbox" | "room";
  label?: string;
  initial: number;
  min: number;
  max: number;
}) {
  const key = `relay-${pane}-width`,
    variable = `--${pane}-width`;
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(key));
    const value = stored >= min && stored <= max ? stored : initial;
    document.documentElement.style.setProperty(variable, `${value}px`);
    return value;
  });
  const update = (value: number) => {
    const next = Math.max(min, Math.min(max, value));
    setWidth(next);
    document.documentElement.style.setProperty(variable, `${next}px`);
    localStorage.setItem(key, String(next));
  };
  return (
    <div
      className="pane-resizer"
      role="separator"
      aria-label={label ?? `Resize ${pane}`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onDoubleClick={() => update(initial)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          update(width + (e.key === "ArrowLeft" ? -10 : 10));
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const element = e.currentTarget;
        const start = e.clientX,
          origin = width;
        element.setPointerCapture(e.pointerId);
        const move = (event: PointerEvent) =>
          update(origin + event.clientX - start);
        const stop = () => {
          element.removeEventListener("pointermove", move);
          element.removeEventListener("pointerup", stop);
          element.removeEventListener("pointercancel", stop);
        };
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", stop);
        element.addEventListener("pointercancel", stop);
      }}
    />
  );
}
