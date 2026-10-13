import { useRef, useState } from "react";
import { clock, parseClock } from "./clockify-format";

const STEP = 5 * 60_000;
/** Pixels of drag per step. */
const NOTCH = 6;
/** How far back the service lets the start go. */
const FURTHEST = 24 * 60 * 60_000;

/** The next 5-minute mark that way, so 9:12 steps to 9:10 or 9:15. */
const stepFrom = (at: number, dir: number) =>
  dir < 0
    ? Math.ceil(at / STEP) * STEP - STEP
    : Math.floor(at / STEP) * STEP + STEP;

/**
 * When the day started, editable where it's shown: drag it sideways or
 * scroll on it to move it 5 minutes at a time, double-click to type it.
 * The panel's clock follows along through `onPreview` before anything saves.
 */
export function ClockifyStart({
  start,
  latest,
  onPreview,
  onSet,
  onEditing,
}: {
  /** What's shown: the saved start, or the one being moved. */
  start: number;
  /** Now, or the first pause; the start can't move past it. */
  latest: () => number;
  onPreview: (at: number | undefined) => void;
  onSet: (at: number) => void;
  /** Holds the hover panel open while a gesture or typing is under way. */
  onEditing: (editing: boolean) => void;
}) {
  const [typing, setTyping] = useState<string>();
  const closed = useRef(false);
  const drag = useRef<{ x: number; from: number; moved: boolean }>(null);
  // Trackpads send several wheel events per frame; each steps from the last.
  const live = useRef(start);
  const wheel = useRef({ sum: 0, timer: 0 });
  const clamp = (at: number) =>
    Math.min(latest(), Math.max(Date.now() - FURTHEST, at));
  const preview = (at: number) => {
    live.current = at;
    onPreview(at);
  };
  const finish = (at: number | undefined) => {
    onEditing(false);
    if (at === undefined) onPreview(undefined);
    else onSet(at);
  };

  const type = () => {
    closed.current = false;
    onEditing(true);
    setTyping(clock(start));
  };

  if (typing !== undefined) {
    const parsed = parseClock(typing, start);
    const valid =
      parsed !== undefined && parsed <= latest() ? parsed : undefined;
    const close = (keep: boolean) => {
      // Enter unmounts the field, which can fire its blur too.
      if (closed.current) return;
      closed.current = true;
      setTyping(undefined);
      finish(keep ? valid : undefined);
    };
    return (
      <input
        className="clockify-start"
        aria-label="When the day started"
        aria-invalid={valid === undefined || undefined}
        value={typing}
        size={Math.max(4, typing.length)}
        spellCheck={false}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setTyping(e.target.value);
          const at = parseClock(e.target.value, start);
          onPreview(at !== undefined && at <= latest() ? at : undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (valid !== undefined) close(true);
          } else if (e.key === "Escape") {
            // The panel would close on the same key.
            e.stopPropagation();
            close(false);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const at = clamp(
              stepFrom(valid ?? start, e.key === "ArrowUp" ? 1 : -1),
            );
            setTyping(clock(at));
            onPreview(at);
          }
        }}
        onBlur={() => close(true)}
      />
    );
  }

  return (
    <button
      type="button"
      className="clockify-start"
      title="Drag or scroll to move when the day started, double-click to type it"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, from: start, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const steps = Math.trunc((e.clientX - d.x) / NOTCH);
        if (!steps && !d.moved) return;
        if (!d.moved) onEditing(true);
        d.moved = true;
        let at = d.from;
        for (let i = 0; i < Math.abs(steps); i++)
          at = stepFrom(at, Math.sign(steps));
        preview(clamp(at));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) finish(live.current);
      }}
      onPointerCancel={() => {
        if (drag.current?.moved) finish(undefined);
        drag.current = null;
      }}
      onWheel={(e) => {
        const w = wheel.current;
        const delta = e.deltaY + e.deltaX;
        if (Math.sign(delta) !== Math.sign(w.sum)) w.sum = 0;
        w.sum += delta;
        if (Math.abs(w.sum) < 30) return;
        if (!w.timer) {
          live.current = start;
          onEditing(true);
        }
        preview(clamp(stepFrom(live.current, w.sum > 0 ? -1 : 1)));
        w.sum = 0;
        window.clearTimeout(w.timer);
        w.timer = window.setTimeout(() => {
          w.timer = 0;
          finish(live.current);
        }, 700);
      }}
      onDoubleClick={type}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          type();
        }
      }}
    >
      {clock(start)}
    </button>
  );
}
