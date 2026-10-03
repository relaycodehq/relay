import { useId, useRef, type CSSProperties } from "react";

const SLOTS = 48;

/** Half-hours of `day` by the clock, so a DST day still reads 0:00…23:30. */
function slotsOf(day: number) {
  return Array.from({ length: SLOTS }, (_, i) => {
    const at = new Date(day);
    at.setHours(Math.floor(i / 2), (i % 2) * 30, 0, 0);
    return at.getTime();
  });
}

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * The time of day on a turning drum, like the quick switch's: each notch of
 * the wheel, or 40px of trackpad, clicks the next half-hour into the band.
 */
export function TimeDrum({
  day,
  at,
  earliest,
  onPick,
  onCommit,
}: {
  /** Midnight of the picked day. */
  day: number;
  at: number;
  /** Rows before this stay on the drum, dimmed, but it won't turn to them. */
  earliest: number;
  onPick: (at: number) => void;
  onCommit: () => void;
}) {
  const slots = slotsOf(day);
  const index = Math.max(
    0,
    slots.findIndex((slot) => slot >= at),
  );
  const first = Math.max(
    0,
    slots.findIndex((slot) => slot >= earliest),
  );
  // Trackpads send several events per frame; each must step from the last
  // step, not from the last render.
  const live = useRef(index);
  live.current = index;
  const go = (to: number) => {
    const next = Math.min(SLOTS - 1, Math.max(first, to));
    if (next === live.current) return;
    live.current = next;
    onPick(slots[next]);
  };

  const sum = useRef(0);
  const id = useId();
  return (
    <div
      className="time-drum"
      role="listbox"
      tabIndex={0}
      aria-label="Time"
      aria-activedescendant={`${id}-${index}`}
      onWheel={(e) => {
        if (Math.sign(e.deltaY) !== Math.sign(sum.current)) sum.current = 0;
        sum.current += e.deltaY;
        if (Math.abs(sum.current) < 40) return;
        // One row per event, so a mouse notch is one click; only a
        // trackpad's small steps carry their leftover into the next.
        const dir = Math.sign(sum.current);
        sum.current = Math.abs(e.deltaY) >= 40 ? 0 : sum.current - dir * 40;
        go(live.current + dir);
      }}
      onKeyDown={(e) => {
        const from = live.current;
        const to = {
          ArrowUp: from - 1,
          ArrowDown: from + 1,
          PageUp: from - 4,
          PageDown: from + 4,
          Home: first,
          End: SLOTS - 1,
        }[e.key];
        if (to !== undefined) {
          e.preventDefault();
          go(to);
        } else if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        }
      }}
    >
      <span className="time-drum-band" aria-hidden />
      {slots.map((slot, i) => {
        const d = i - index;
        return (
          <div
            // By position, not time: a new day turns the same rows.
            key={i}
            id={`${id}-${i}`}
            role="option"
            className="time-drum-row"
            aria-selected={d === 0}
            aria-disabled={i < first || undefined}
            style={
              {
                // Rows far off wait behind the drum, so a long jump spins
                // them in rather than round several turns.
                "--d": Math.max(-7, Math.min(7, d)),
                "--ad": Math.min(Math.abs(d), 6),
              } as CSSProperties
            }
            onClick={() => i >= first && go(i)}
          >
            {timeOf(slot)}
          </div>
        );
      })}
    </div>
  );
}
