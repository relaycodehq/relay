// The line under a finished turn about what Claude left behind, shared by the
// desktop's WaitingStrip and the phone's.
import type { ChatPending } from "./projects";

/** "12s", "3m", "1h 4m": minutes are enough once it has run a while. */
function span(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function wakeupTitle(item: Extract<ChatPending, { kind: "wakeup" }>) {
  if (!item.at) return "Claude checks back on a schedule";
  return `Claude will check back at ${clock(item.at)}`;
}

export function timing(item: ChatPending, now: number) {
  if (item.kind === "task") return span(now - item.since);
  if (!item.at) return undefined;
  return item.at > now ? `in ${span(item.at - now)}` : "any moment";
}

/**
 * The strip's head line. Claude's turn is over, so its background commands
 * are just running, not something it waits on: dev servers, emulators and
 * watchers never exit. Wake-ups are the only thing it really comes back for.
 */
export function summary(
  pending: ChatPending[],
  now: number,
): { title: string; detail: string } {
  const tasks = pending.filter((p) => p.kind === "task");
  const wakeups = pending.length - tasks.length;
  const [first] = pending;
  if (first.kind === "wakeup") {
    const when = timing(first, now);
    return {
      title: wakeupTitle(first),
      detail:
        (when ? ` · ${when}` : "") +
        (pending.length > 1 ? ` · +${pending.length - 1} more` : ""),
    };
  }
  const also = wakeups
    ? ` · +${wakeups} ${wakeups === 1 ? "wake-up" : "wake-ups"}`
    : "";
  if (tasks.length > 1)
    return { title: `${tasks.length} running in the background`, detail: also };
  return {
    title: first.description,
    detail: ` · running in the background · ${timing(first, now)}${also}`,
  };
}
