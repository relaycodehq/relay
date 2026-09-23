import { useEffect, useState } from "react";
import {
  AlarmClock,
  ChevronDown,
  CircleStop,
  Clock,
  SquareTerminal,
} from "lucide-react";
import type { ChatPending } from "../../shared/projects";
import "./waiting-strip.css";

function useNow(interval: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

/** "12s", "3m", "1h 4m": minutes are enough once it has run a while. */
function span(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "Run the A/B" reads as "…waiting on run the A/B"; acronyms keep their case. */
function lower(text: string) {
  return /^[A-Z][a-z]/.test(text)
    ? text[0].toLowerCase() + text.slice(1)
    : text;
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function title(item: ChatPending) {
  if (item.kind === "task")
    return `Claude is waiting on ${lower(item.description)}`;
  if (!item.at) return "Claude checks back on a schedule";
  return `Claude will check back at ${clock(item.at)}`;
}

function timing(item: ChatPending, now: number) {
  if (item.kind === "task") return span(now - item.since);
  if (!item.at) return undefined;
  return item.at > now ? `in ${span(item.at - now)}` : "any moment";
}

/** Stays pressed until the work leaves the list; the SDK confirms by dropping it. */
function StopButton({
  item,
  onStop,
}: {
  item: ChatPending;
  onStop: (item: ChatPending) => Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);
  const task = item.kind === "task";
  return (
    <button
      type="button"
      disabled={stopping}
      onClick={() => {
        setStopping(true);
        onStop(item).catch(() => setStopping(false));
      }}
    >
      {stopping
        ? task
          ? "Stopping…"
          : "Cancelling…"
        : task
          ? "Stop"
          : "Cancel"}
    </button>
  );
}

/**
 * Claude ended its turn but left work running that will start the next one:
 * a background command, a subagent, a scheduled wake-up. Docked on the
 * composer so it can't scroll away. Still, because nothing is working yet.
 */
export function WaitingStrip({
  pending,
  onStop,
}: {
  pending: ChatPending[];
  /** Stops a task, or asks Claude to cancel a wake-up. */
  onStop: (item: ChatPending) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(1000);
  const [first] = pending;
  const firstTiming = timing(first, now);
  const tasks = pending.filter((p) => p.kind === "task").length;
  return (
    <div className="waiting-strip" role="status">
      {open && pending.length > 1 && (
        <ul className="waiting-strip-list">
          {pending.map((item) => (
            <li key={item.id}>
              {item.kind === "task" ? (
                <SquareTerminal size={14} />
              ) : (
                <AlarmClock size={14} />
              )}
              <span className="waiting-strip-what">
                {item.kind === "task"
                  ? item.description
                  : item.prompt || title(item)}
              </span>
              <span className="waiting-strip-when">
                {item.kind === "wakeup" && item.at
                  ? `${clock(item.at)} · `
                  : ""}
                {timing(item, now) ?? "repeats"}
              </span>
              <StopButton item={item} onStop={onStop} />
            </li>
          ))}
        </ul>
      )}
      <div className="waiting-strip-head">
        {first.kind === "task" ? <Clock size={15} /> : <AlarmClock size={15} />}
        <span className="waiting-strip-text">
          <b>{title(first)}</b>
          <span>
            {firstTiming && ` · ${firstTiming}`}
            {pending.length > 1
              ? ` · +${pending.length - 1} more`
              : tasks
                ? " · replies on its own when it's done"
                : ""}
          </span>
        </span>
        {pending.length === 1 && <StopButton item={first} onStop={onStop} />}
        {pending.length > 1 && (
          <button
            type="button"
            className="waiting-strip-toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            Details
            <ChevronDown size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Relay closed while Claude was waiting on this work, which ended with it. */
export function StoppedStrip({
  items,
  onResolve,
}: {
  items: ChatPending[];
  onResolve: (action: "resume" | "dismiss") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [first] = items;
  const act = (action: "resume" | "dismiss") => {
    setBusy(true);
    onResolve(action).catch(() => setBusy(false));
  };
  return (
    <div className="waiting-strip stopped" role="status">
      <div className="waiting-strip-head">
        <CircleStop size={15} />
        <span
          className="waiting-strip-text"
          title={items
            .map((i) => (i.kind === "task" ? i.description : i.prompt))
            .join("\n")}
        >
          <b>
            Relay closed while Claude was waiting on{" "}
            {first.kind === "task"
              ? lower(first.description)
              : "a recurring wake-up"}
          </b>
          <span>
            {items.length > 1 ? ` · +${items.length - 1} more` : ""} · it
            stopped
          </span>
        </span>
        <button type="button" disabled={busy} onClick={() => act("dismiss")}>
          Dismiss
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={() => act("resume")}
        >
          Pick it back up
        </button>
      </div>
    </div>
  );
}
