import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { TimeDrum } from "./TimeDrum";
import "./pick-time.css";

const MIN = 60_000,
  SLOT = 30 * MIN,
  DAY = 24 * 60 * MIN;

const midnight = (date: Date) => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const timeOf = (at: Date) =>
  at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Monday unless the locale starts its week elsewhere. */
function weekStart(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (first) return first % 7;
  } catch {
    // An engine without week info: fall through.
  }
  return 1;
}

/** Six weeks, so the grid keeps its height from month to month. */
function monthCells(month: Date, start: number): (Date | null)[] {
  const lead = (month.getDay() - start + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(month.getFullYear(), month.getMonth(), i - lead + 1);
    return day.getMonth() === month.getMonth() ? day : null;
  });
}

/** "Today 15:00", "Tomorrow 9:00", "Fri 2 Oct, 9:00". */
function whenLabel(at: number, now: Date): string {
  const wake = new Date(at);
  const days = Math.round(
    (midnight(wake).getTime() - midnight(now).getTime()) / DAY,
  );
  if (days === 0) return `Today ${timeOf(wake)}`;
  if (days === 1) return `Tomorrow ${timeOf(wake)}`;
  const date = wake.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(wake.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
  return `${date}, ${timeOf(wake)}`;
}

/** "in 45 min", "in 2 h 15 min", "in 30 h", "in 3 days". */
function fromNow(at: number, now: Date): string {
  const mins = Math.round((at - now.getTime()) / MIN);
  if (mins < 60) return `in ${Math.max(mins, 1)} min`;
  const h = Math.floor(mins / 60),
    m = mins % 60;
  if (h < 10 && m) return `in ${h} h ${m} min`;
  if (h < 48) return `in ${h} h`;
  const days = Math.round(
    (midnight(new Date(at)).getTime() - midnight(now).getTime()) / DAY,
  );
  return `in ${days} days`;
}

/** A day on a month grid and a half-hour on a drum beside it, for a menu's "Pick a time…". */
export function PickTime({
  action,
  hint,
  onPick,
  onBack,
}: {
  /** The confirm button, e.g. "Snooze". */
  action: string;
  /** What happens at that time, on the button's tooltip. */
  hint?: string;
  onPick: (at: number) => void;
  /** Puts a back arrow before the month, to the presets this came from. */
  onBack?: () => void;
}) {
  const [now] = useState(() => new Date());
  const earliest = now.getTime() + 15 * MIN;
  const firstSlot = Math.ceil(earliest / SLOT) * SLOT;
  // An hour ahead, on the next half-hour.
  const [at, setAt] = useState(
    () => Math.ceil((now.getTime() + 60 * MIN) / SLOT) * SLOT,
  );
  const [month, setMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const start = useMemo(weekStart, []);
  const today = midnight(now);
  const day = midnight(new Date(at));
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() + 11, 1);

  /** The same time on another day, or the first one still ahead. */
  const pickDay = (next: Date) => {
    if (next < today) next = today;
    const wake = new Date(next);
    const time = new Date(at);
    wake.setHours(time.getHours(), time.getMinutes(), 0, 0);
    setAt(Math.max(wake.getTime(), firstSlot));
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };

  const grid = useRef<HTMLDivElement>(null);
  // The row that opened the picker is gone; the keyboard picks up on the day.
  useEffect(() => {
    grid.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!grid.current?.contains(document.activeElement)) return;
    grid.current
      .querySelector<HTMLElement>(`[data-day="${dayKey(day)}"]`)
      ?.focus({ preventScroll: true });
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    // 4 Jan 2026 was a Sunday.
    new Date(2026, 0, 4 + ((start + i) % 7))
      .toLocaleDateString(undefined, { weekday: "short" })
      .slice(0, 2),
  );

  return (
    <div className="pick-time">
      <div className="pick-time-head">
        {onBack && (
          <button
            className="pick-time-icon"
            aria-label="Back"
            title="Back"
            onClick={onBack}
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <strong className="pick-time-month">
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </strong>
        <button
          className="pick-time-icon"
          aria-label="Previous month"
          disabled={month <= thisMonth}
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="pick-time-icon"
          aria-label="Next month"
          disabled={month >= lastMonth}
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="pick-time-body">
        <div
          ref={grid}
          className="pick-time-grid"
          role="grid"
          aria-label="Day"
          onKeyDown={(e) => {
            const step = {
              ArrowLeft: -1,
              ArrowRight: 1,
              ArrowUp: -7,
              ArrowDown: 7,
            }[e.key];
            if (step) {
              e.preventDefault();
              pickDay(addDays(day, step));
            } else if (e.key === "Enter") {
              e.preventDefault();
              onPick(at);
            }
          }}
        >
          {weekdays.map((name, i) => (
            <span key={i} className="pick-time-weekday" aria-hidden>
              {name}
            </span>
          ))}
          {monthCells(month, start).map((cell, i) =>
            cell ? (
              <button
                key={i}
                className="pick-time-day"
                data-day={dayKey(cell)}
                data-today={cell.getTime() === today.getTime() || undefined}
                aria-selected={cell.getTime() === day.getTime()}
                aria-label={cell.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
                tabIndex={cell.getTime() === day.getTime() ? 0 : -1}
                disabled={cell < today}
                onClick={() => pickDay(cell)}
              >
                {cell.getDate()}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
        <TimeDrum
          day={day.getTime()}
          at={at}
          earliest={earliest}
          onPick={setAt}
          onCommit={() => onPick(at)}
        />
      </div>
      <div className="pick-time-foot">
        <div className="pick-time-when" aria-live="polite">
          <strong>{whenLabel(at, now)}</strong>
          <small>{fromNow(at, now)}</small>
        </div>
        <button
          className="pick-time-go"
          title={hint}
          onClick={() => onPick(at)}
        >
          {action}
        </button>
      </div>
    </div>
  );
}
