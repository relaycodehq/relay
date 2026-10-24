// When a schedule runs, picked the way Snooze picks a time: the same popup,
// month grid and time drum. The grid marks every day it runs; a day clicked
// makes it run on that weekday, or that date when it's monthly.
import { Popover } from "@base-ui/react/popover";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { formatDate } from "../../../shared/date-format";
import {
  nextRun,
  runsOnDay,
  scheduleWhenLabel,
  type ScheduleRepeat,
  type ScheduleWhen,
} from "../../../shared/schedules";
import { TimeDrum } from "../../ui/TimeDrum";
import "../../ui/pick-time.css";
import { fromNow } from "./schedule-format";

const repeats: [ScheduleRepeat, string][] = [
  ["daily", "Daily"],
  ["weekdays", "Weekdays"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
];

// 5 Jan 2026 was a Monday.
const weekdays = Array.from({ length: 7 }, (_, i) =>
  formatDate(new Date(2026, 0, 5 + i), { weekday: "short" }).slice(0, 2),
);

const midnight = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The month's days in weeks from Monday, blanks before the 1st. */
function monthCells(month: Date): (Date | undefined)[] {
  const lead = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return [
    ...Array.from({ length: lead }, () => undefined),
    ...Array.from(
      { length: count },
      (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1),
    ),
  ];
}

const clock = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function RepeatPicker({
  value,
  onChange,
}: {
  value: ScheduleWhen;
  onChange: (next: ScheduleWhen) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="composer-control schedule-when"
        aria-label="When it runs"
      >
        <CalendarClock size={13} />
        <span>{scheduleWhenLabel(value)}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="sb-menu-positioner"
        >
          <Popover.Popup className="sb-menu" aria-label="When it runs">
            <RepeatPanel
              value={value}
              onChange={onChange}
              onDone={() => setOpen(false)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RepeatPanel({
  value,
  onChange,
  onDone,
}: {
  value: ScheduleWhen;
  onChange: (next: ScheduleWhen) => void;
  onDone: () => void;
}) {
  const today = midnight(new Date());
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [h, m] = value.time.split(":").map(Number);
  const at = new Date(today).setHours(h, m);
  const set = (patch: Partial<ScheduleWhen>) => onChange({ ...value, ...patch });

  const pickDay = (d: Date) => {
    const weekday = (d.getDay() + 6) % 7;
    if (value.repeat === "monthly") return set({ monthDay: d.getDate() });
    if (value.repeat !== "weekly")
      return set({ repeat: "weekly", days: [weekday] });
    const days = value.days.includes(weekday)
      ? value.days.filter((x) => x !== weekday)
      : [...value.days, weekday].sort();
    // The last day stays: a weekly schedule runs on at least one.
    if (days.length) set({ days });
  };

  return (
    <div className="pick-time schedule-pick">
      <div className="pick-time-head">
        <span className="schedule-pick-repeats" role="radiogroup" aria-label="Repeat">
          {repeats.map(([repeat, label]) => (
            <button
              key={repeat}
              role="radio"
              aria-checked={value.repeat === repeat}
              onClick={() =>
                set({
                  repeat,
                  ...(repeat === "weekly" && !value.days.length ? { days: [4] } : {}),
                  ...(repeat === "monthly" && !value.monthDay
                    ? { monthDay: today.getDate() }
                    : {}),
                })
              }
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <div className="pick-time-head schedule-pick-month">
        <strong className="pick-time-month">
          {formatDate(month, { month: "long", year: "numeric" })}
        </strong>
        <button
          className="pick-time-icon"
          aria-label="Previous month"
          disabled={month.getTime() <= new Date(today.getFullYear(), today.getMonth(), 1).getTime()}
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="pick-time-icon"
          aria-label="Next month"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="pick-time-body">
        <div className="pick-time-grid" role="grid" aria-label="Days it runs">
          {weekdays.map((name, i) => (
            <span key={i} className="pick-time-weekday" aria-hidden>
              {name}
            </span>
          ))}
          {monthCells(month).map((cell, i) =>
            cell ? (
              <button
                key={i}
                className="pick-time-day"
                data-today={cell.getTime() === today.getTime() || undefined}
                data-past={cell < today || undefined}
                aria-selected={runsOnDay(value, cell)}
                aria-label={formatDate(cell, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
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
          day={today.getTime()}
          at={at}
          earliest={today.getTime()}
          onPick={(picked) => set({ time: clock(picked) })}
          onCommit={onDone}
        />
      </div>
      <div className="pick-time-foot">
        <div className="pick-time-when" aria-live="polite">
          <strong>{scheduleWhenLabel(value)}</strong>
          <small>next {fromNow(nextRun(value, Date.now()))}</small>
        </div>
        <button className="pick-time-go" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
