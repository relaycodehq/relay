import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./slider.css";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Marked on the bar; a drag clicks into it and double-click goes back to it. */
  defaultValue?: number;
  /** Drawn inside the bar while it is swollen. */
  icon?: ReactNode;
  "aria-label": string;
  /** How screen readers hear the value. */
  format?: (value: number) => string;
  onChange: (value: number) => void;
  /** When the user lets go: pointer up, a key up, a double-click reset. */
  onCommit?: (value: number) => void;
}

/**
 * A slim bar that swells while hovered or dragged. Drags are relative, so
 * there is no thumb to aim for; a tap without a drag jumps to the spot.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  defaultValue,
  icon,
  format = String,
  onChange,
  onCommit,
  ...aria
}: SliderProps) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    value: number;
    width: number;
    moved: boolean;
  } | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const [dragging, setDragging] = useState(false);
  const [pointer, setPointer] = useState(false);
  const [overshoot, setOvershoot] = useState(0);
  const [detent, setDetent] = useState(0);
  const range = max - min || 1;
  const fraction = (v: number) => (v - min) / range;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const quantize = (v: number) =>
    clamp(+(min + Math.round((v - min) / step) * step).toFixed(6));
  // Within 4px of the default, a drag clicks into it.
  const snap = (raw: number, width: number) =>
    defaultValue !== undefined &&
    (Math.abs(raw - defaultValue) / range) * width <= 4
      ? defaultValue
      : quantize(raw);

  const change = (next: number) => {
    if (next === latest.current) return;
    if (next === defaultValue && drag.current?.moved) setDetent((n) => n + 1);
    latest.current = next;
    onChange(next);
  };
  const at = (clientX: number) => {
    const box = bar.current!.getBoundingClientRect();
    return (
      min + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * range
    );
  };

  const style = {
    "--t": fraction(value),
    "--d": defaultValue === undefined ? undefined : fraction(defaultValue),
    "--stretch": Math.abs(overshoot),
    "--origin": overshoot < 0 ? "right" : "left",
  } as CSSProperties;

  return (
    <div
      className="slider"
      role="slider"
      tabIndex={0}
      aria-label={aria["aria-label"]}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      data-drag={dragging || undefined}
      data-pointer={pointer || undefined}
      data-default={value === defaultValue || undefined}
      style={style}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus({ preventScroll: true });
        const width = bar.current!.getBoundingClientRect().width;
        drag.current = { x: e.clientX, value, width, moved: false };
        setPointer(true);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
        if (!d.moved) return;
        const raw = d.value + ((e.clientX - d.x) / d.width) * range;
        const past =
          (raw < min ? raw - min : raw > max ? raw - max : 0) / range;
        // Rubber band: the further past an end, the less it gives.
        setOvershoot(
          Math.sign(past) * 0.1 * (1 - 1 / (Math.abs(past) * 5.5 + 1)),
        );
        change(snap(raw, d.width));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved) change(snap(at(e.clientX), d.width));
        drag.current = null;
        setDragging(false);
        setOvershoot(0);
        onCommit?.(latest.current);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
        setOvershoot(0);
      }}
      onDoubleClick={() => {
        if (defaultValue === undefined) return;
        change(defaultValue);
        onCommit?.(defaultValue);
      }}
      onKeyDown={(e) => {
        const big = Math.max(step, Math.round(range / 10 / step) * step);
        const dir = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[
          e.key
        ];
        let next: number;
        if (dir) next = value + dir * (e.shiftKey ? big : step);
        else if (e.key === "PageUp") next = value + big;
        else if (e.key === "PageDown") next = value - big;
        else if (e.key === "Home") next = min;
        else if (e.key === "End") next = max;
        else return;
        e.preventDefault();
        setPointer(false);
        change(clamp(+next.toFixed(6)));
      }}
      onKeyUp={() => onCommit?.(latest.current)}
    >
      <div className="slider-bar" ref={bar}>
        <div className="slider-layer">{icon}</div>
        <div
          className="slider-layer slider-fill"
          key={detent}
          data-bump={detent > 0 || undefined}
          aria-hidden
        >
          {icon}
        </div>
        <i className="slider-grip" />
        {defaultValue !== undefined && <i className="slider-notch" />}
      </div>
    </div>
  );
}
