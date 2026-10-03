// C · Timeline: time is a tape under a fixed needle. Drag it, flick it and
// it coasts, scroll it, or tap a day above to jump. It snaps to quarter
// hours and starts at now, so the past can't be picked.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PickHead, PresetMenu, type PickerProps } from "./snooze-picker-common";
import { DAY, HOUR, MIN, addDays, fromNow, midnight } from "./snooze-when";

const STEP = 15 * MIN;
const PX_PER_HOUR = 64;
const MS_PER_PX = HOUR / PX_PER_HOUR;
const DAYS = 21;

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function TimelinePicker({ onSnooze }: PickerProps) {
  const [now] = useState(() => new Date());
  const [view, setView] = useState<"menu" | "pick">("menu");
  return view === "menu" ? (
    <PresetMenu
      now={now}
      onSnooze={onSnooze}
      more="Pick a time…"
      onMore={() => setView("pick")}
    />
  ) : (
    <TimelineView
      now={now}
      onSnooze={onSnooze}
      onBack={() => setView("menu")}
    />
  );
}

function dayName(day: Date, today: Date, style: "long" | "short") {
  const diff = Math.round((day.getTime() - today.getTime()) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1 && style === "long") return "Tomorrow";
  return day.toLocaleDateString(
    undefined,
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long" }
      : { weekday: "short" },
  );
}

function TimelineView({
  now,
  onSnooze,
  onBack,
}: PickerProps & { now: Date; onBack: () => void }) {
  const today = midnight(now);
  const min = Math.ceil((now.getTime() + 15 * MIN) / STEP) * STEP;
  const max = addDays(today, DAYS).getTime() - STEP;
  const clamp = (t: number) => Math.min(max, Math.max(min, t));
  const snap = (t: number) => clamp(Math.round(t / STEP) * STEP);

  const [value, setValue] = useState(() => snap(now.getTime() + HOUR));
  const [pos, setPos] = useState(value);
  const posRef = useRef(pos);
  const move = (p: number) => {
    posRef.current = p;
    setPos(p);
  };
  const frame = useRef(0);
  const glide = (target: number) => {
    cancelAnimationFrame(frame.current);
    const from = posRef.current;
    if (reducedMotion() || Math.abs(target - from) > 36 * HOUR)
      return move(target);
    const start = performance.now();
    const duration = Math.min(460, 200 + (Math.abs(target - from) / HOUR) * 40);
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      move(from + (target - from) * (1 - (1 - k) ** 3));
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  const go = (t: number) => {
    const next = snap(t);
    setValue(next);
    glide(next);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const ruler = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  useLayoutEffect(() => {
    setWidth(ruler.current!.clientWidth);
    ruler.current!.focus({ preventScroll: true });
  }, []);

  // Wheel and trackpad scrub it; React's wheel listener can't preventDefault.
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const el = ruler.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(frame.current);
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const delta = sideways ? e.deltaX : e.deltaY * 0.5;
      const p = clamp(posRef.current + delta * MS_PER_PX);
      move(p);
      setValue(snap(p));
      clearTimeout(settle.current);
      settle.current = setTimeout(() => go(posRef.current), 140);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useRef<{
    x: number;
    pos: number;
    moved: boolean;
    samples: { x: number; t: number }[];
  } | null>(null);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const picked = midnight(new Date(value));
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const button = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !button) return;
    const left = button.offsetLeft - 4,
      right = button.offsetLeft + button.offsetWidth + 4;
    if (left < el.scrollLeft) el.scrollTo({ left, behavior: "smooth" });
    else if (right > el.scrollLeft + el.clientWidth)
      el.scrollTo({ left: right - el.clientWidth, behavior: "smooth" });
  }, [picked.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = strip.current!;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Only the ticks on screen, plus an hour each side for labels.
  const reach = (width / 2) * MS_PER_PX + HOUR;
  const ticks: number[] = [];
  for (
    let t = Math.floor((pos - reach) / STEP) * STEP;
    t <= pos + reach;
    t += STEP
  )
    ticks.push(t);
  const centre = width / 2;
  const wake = new Date(value);

  return (
    <div className="sp-view sp-tl">
      <PickHead onBack={onBack}>
        <span className="sp-head-title">Pick a time</span>
      </PickHead>
      <div className="sp-readout" aria-live="polite">
        <span className="sp-readout-day">{dayName(picked, today, "long")}</span>
        <span className="sp-readout-time">
          {wake.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className="sp-readout-rel">{fromNow(value, now)}</span>
      </div>
      <div ref={strip} className="sp-days" role="group" aria-label="Day">
        {days.map((day) => {
          const on = day.getTime() === picked.getTime();
          return (
            <button
              key={day.getTime()}
              className="sp-dayc"
              aria-pressed={on}
              aria-label={day.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              onClick={() => {
                const next = new Date(day);
                next.setHours(wake.getHours(), wake.getMinutes(), 0, 0);
                go(next.getTime());
              }}
            >
              <span>{dayName(day, today, "short")}</span>
              <b>{day.getDate()}</b>
            </button>
          );
        })}
      </div>
      <div
        ref={ruler}
        className="sp-ruler"
        role="slider"
        tabIndex={0}
        data-autofocus
        aria-label="Wake time"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${dayName(picked, today, "long")}, ${wake.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 4 : 1;
          const step = {
            ArrowRight: STEP * big,
            ArrowUp: STEP * big,
            ArrowLeft: -STEP * big,
            ArrowDown: -STEP * big,
            PageUp: DAY,
            PageDown: -DAY,
          }[e.key];
          if (step) {
            e.preventDefault();
            go(value + step);
          } else if (e.key === "Home") {
            e.preventDefault();
            go(min);
          } else if (e.key === "Enter") {
            e.preventDefault();
            onSnooze(value);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          cancelAnimationFrame(frame.current);
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            pos: posRef.current,
            moved: false,
            samples: [{ x: e.clientX, t: e.timeStamp }],
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 3) d.moved = true;
          if (!d.moved) return;
          let p = d.pos - dx * MS_PER_PX;
          // Past either end it gives a little, then snaps back.
          if (p < min) p = min - (min - p) * 0.25;
          if (p > max) p = max + (p - max) * 0.25;
          move(p);
          setValue(snap(p));
          d.samples.push({ x: e.clientX, t: e.timeStamp });
          while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 80)
            d.samples.shift();
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (!d.moved) {
            const box = e.currentTarget.getBoundingClientRect();
            return go(
              posRef.current +
                (e.clientX - box.left - box.width / 2) * MS_PER_PX,
            );
          }
          const first = d.samples[0],
            last = d.samples[d.samples.length - 1];
          const fresh = e.timeStamp - last.t < 60 && last.t > first.t;
          const velocity = fresh ? (last.x - first.x) / (last.t - first.t) : 0;
          // A flick coasts about a quarter second further.
          go(posRef.current - velocity * 260 * MS_PER_PX);
        }}
        onPointerCancel={() => {
          drag.current = null;
          go(posRef.current);
        }}
      >
        {ticks.map((t) => {
          const at = new Date(t);
          const x = centre + (t - pos) / MS_PER_PX;
          const minute = at.getMinutes();
          const kind =
            minute !== 0
              ? minute === 30
                ? "half"
                : "quarter"
              : at.getHours() === 0
                ? "day"
                : "hour";
          const label =
            kind === "day"
              ? at.toLocaleDateString(undefined, { weekday: "short" })
              : kind === "hour"
                ? at.toLocaleTimeString(undefined, { hour: "numeric" })
                : null;
          const fade = Math.min(
            1,
            Math.max(0, (Math.abs(x - centre) - 12) / 18),
          );
          return (
            <span
              key={t}
              className={`sp-tick ${kind} ${t < min ? "past" : ""}`}
              style={{ transform: `translateX(${x}px)` }}
            >
              {label && (
                <span className="sp-tick-label" style={{ opacity: fade }}>
                  {label}
                </span>
              )}
            </span>
          );
        })}
        <span className="sp-needle" aria-hidden />
      </div>
      <div className="sp-foot">
        <small className="sp-foot-hint">Drag, scroll or use ← →</small>
        <button className="sp-go" onClick={() => onSnooze(value)}>
          Snooze
        </button>
      </div>
    </div>
  );
}
