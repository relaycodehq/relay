import { useState } from "react";
import { Splitter } from "./Splitter";

export function PaneResizer({
  pane,
  label,
  initial,
  min,
  max,
}: {
  pane: "sidebar" | "inbox" | "changes" | "files";
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
    <Splitter
      className="pane-resizer"
      label={label ?? `Resize ${pane}`}
      value={width}
      min={min}
      max={max}
      begin={() => {
        const origin = width;
        return (delta) => update(origin + delta);
      }}
      onReset={() => update(initial)}
    />
  );
}
