// Activity's rules for the sidebar: how triage shows before the desktop has
// it, where settling the open thread moves on to, and what the bell counts.
import type { ChatSummary, ChatTriage } from "../../../shared/projects";
import {
  setTriageState,
  type ChatActivitySection,
} from "../../../shared/chat-activity";
import type { DraftRaise } from "./useDraftRaise";

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
    case "restore": {
      const next = { ...chat, autoSettled: undefined };
      setTriageState(next, action.to);
      return next;
    }
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

/**
 * Activity with the threads holding unsent text first, newest first as
 * `all` lists them, settled and snoozed ones included: the draft waits on you.
 * One whose draft is gone keeps its place by when it last had one, until
 * newer activity passes it. Off a shelf, it stays only if the draft went out
 * and it hasn't been settled or snoozed since; a cleared one goes back.
 */
export function draftsFirst<C extends ChatSummary>(
  sections: Record<ChatActivitySection, C[]>,
  all: C[],
  drafted: ReadonlySet<string>,
  raised: ReadonlyMap<string, DraftRaise>,
): Record<ChatActivitySection, C[]> {
  if (!drafted.size && !raised.size) return sections;
  const active = new Set(sections.active);
  const sentOff = (c: C) => {
    const raise = raised.get(c.id);
    return (
      !!raise?.sent &&
      (c.settledAt ?? 0) < raise.at &&
      (c.snoozedAt ?? 0) < raise.at
    );
  };
  const stays = (c: C) => !drafted.has(c.id) && (active.has(c) || sentOff(c));
  const key = (c: C) => Math.max(c.updated, raised.get(c.id)?.at ?? 0);
  const shelf = (list: C[]) =>
    list.filter((c) => !drafted.has(c.id) && !sentOff(c));
  return {
    active: [
      ...all.filter((c) => drafted.has(c.id)),
      ...all.filter(stays).sort((a, b) => key(b) - key(a)),
    ],
    snoozed: shelf(sections.snoozed),
    settled: shelf(sections.settled),
  };
}
