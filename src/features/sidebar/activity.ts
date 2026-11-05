// Activity's rules for the sidebar: how triage shows before the desktop has
// it, where settling the open thread moves on to, and what the bell counts.
import type { ChatSummary, ChatTriage } from "../../../shared/projects";
import { setTriageState } from "../../../shared/chat-activity";
import type { StartedFamilies } from "../../../shared/started-families";

export { draftsFirst } from "../../../shared/chat-activity";

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
    case "pin":
      return {
        ...chat,
        pinnedAt: action.pinned ? (chat.pinnedAt ?? now) : undefined,
      };
    case "restore": {
      const next = { ...chat, autoSettled: undefined };
      setTriageState(next, action.to);
      return next;
    }
    default: {
      const settles =
        action.kind === "settle" || action.kind === "settle-when-done";
      return {
        ...chat,
        settledAt: settles ? now : undefined,
        settleWhenDone:
          action.kind === "settle-when-done" && chat.running ? now : undefined,
        autoSettled: undefined,
        snoozedAt: action.kind === "snooze" ? now : undefined,
        snoozedUntil: action.kind === "snooze" ? action.until : undefined,
      };
    }
  }
}

/**
 * What opens once the open thread `settled` is settled, among Activity's
 * cards: the card that takes its place, the one before when it was last, or
 * the first when it wasn't listed. A thread another started has no card of
 * its own: it goes back to its lead's card, or stands where its settled
 * lead's header does. Undefined when it was the only one.
 */
export function nextAfterSettle(
  { top, headers }: Pick<StartedFamilies<ChatSummary>, "top" | "headers">,
  settled: Pick<ChatSummary, "id" | "startedBy">,
) {
  const leadId = settled.startedBy?.chatId;
  const cards = top.filter((c) => !headers.has(c.id));
  const lead = cards.find((c) => c.id === leadId);
  if (lead) return lead;
  const rest = cards.filter((c) => c.id !== settled.id);
  const place = top.findIndex((c) => c.id === settled.id || c.id === leadId);
  if (place < 0) return rest[0];
  const cardsAbove = top
    .slice(0, place)
    .filter((c) => !headers.has(c.id)).length;
  return rest[Math.min(cardsAbove, rest.length - 1)];
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
