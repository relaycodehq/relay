// Activity's rules for the sidebar: how triage shows before the desktop has
// it, where settling the open thread moves on to, and what the bell counts.
import type { ChatSummary, ChatTriage } from "../../shared/projects";

/** `chat` as `action` leaves it, at `now`. */
export function triaged(
  chat: ChatSummary,
  action: ChatTriage,
  now: number,
): ChatSummary {
  switch (action.kind) {
    case "archive":
      return { ...chat, archivedAt: now };
    case "unread":
      return { ...chat, markedUnread: true };
    case "auto-settle":
      return { ...chat, autoSettleOff: action.enabled ? undefined : true };
    default:
      return {
        ...chat,
        settledAt: action.kind === "settle" ? now : undefined,
        autoSettled: undefined,
        snoozedAt: action.kind === "snooze" ? now : undefined,
        snoozedUntil: action.kind === "snooze" ? action.until : undefined,
      };
  }
}

/**
 * What opens once the open thread `id` is settled: the active thread that
 * takes its place, the one before when it was last, or the first when it
 * wasn't listed. Undefined when it was the only one.
 */
export function nextAfterSettle(active: ChatSummary[], id: string) {
  const index = active.findIndex((a) => a.id === id);
  const rest = active.filter((a) => a.id !== id);
  return rest[Math.min(Math.max(index, 0), rest.length - 1)];
}

/**
 * How many active threads want you, and the strongest mark among them:
 * a question waiting on you beats news.
 */
export function attention(
  active: ChatSummary[],
  unread: (c: ChatSummary) => boolean,
) {
  const count = active.filter((c) => c.waiting || unread(c)).length;
  const mark: "waiting" | "unread" | undefined = active.some((c) => c.waiting)
    ? "waiting"
    : count > 0
      ? "unread"
      : undefined;
  return { count, mark };
}
