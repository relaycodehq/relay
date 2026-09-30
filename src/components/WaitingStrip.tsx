import { useState } from "react";
import { useNow } from "../lib/useNow";
import {
  AlarmClock,
  CheckCheck,
  ChevronDown,
  CircleStop,
  SquareTerminal,
} from "lucide-react";
import type { ChatPending } from "../../shared/projects";
import { clock, summary, timing, wakeupTitle } from "../../shared/waiting";
import "./waiting-strip.css";

/** "Run the A/B" reads as "…waiting on run the A/B"; acronyms keep their case. */
function lower(text: string) {
  return /^[A-Z][a-z]/.test(text)
    ? text[0].toLowerCase() + text.slice(1)
    : text;
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
 * Claude ended its turn but left work behind: background commands and
 * subagents still running, or a wake-up it scheduled. Docked on the composer
 * so it can't scroll away. Still, because Claude isn't working.
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
  const head = summary(pending, now);
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
                  : item.prompt || wakeupTitle(item)}
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
        {first.kind === "task" ? (
          <SquareTerminal size={15} />
        ) : (
          <AlarmClock size={15} />
        )}
        <span className="waiting-strip-text">
          <b>{head.title}</b>
          <span>{head.detail}</span>
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

/** A settled thread, opened: the next message moves it back to Activity. */
export function SettledStrip({ onUnsettle }: { onUnsettle: () => void }) {
  return (
    <div className="waiting-strip settled" role="status">
      <div className="waiting-strip-head">
        <CheckCheck size={15} />
        <span className="waiting-strip-text">
          <b>Settled</b>
          <span> · replying moves it back to Activity</span>
        </span>
        <button
          type="button"
          title="Move back to activity"
          onClick={onUnsettle}
        >
          Unsettle
        </button>
      </div>
    </div>
  );
}
