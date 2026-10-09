// Activity's rules for the sidebar: how triage shows before the desktop has
// it, where settling the open thread moves on to, and what the bell counts.
import type { ChatSummary, ChatTriage } from "../../../shared/projects";
import {
  setTriageState,
  type ChatActivitySection,
} from "../../../shared/chat-activity";

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
 * One whose draft is gone, sent or cleared, keeps its place by
 * when it last had one (`raised`), until newer activity passes it or it's
 * settled or snoozed since.
 */
export function draftsFirst<C extends ChatSummary>(
  sections: Record<ChatActivitySection, C[]>,
  all: C[],
  drafted: ReadonlySet<string>,
  raised: ReadonlyMap<string, number>,
): Record<ChatActivitySection, C[]> {
  if (!drafted.size && !raised.size) return sections;
  const kept = (c: C) => {
    const at = raised.get(c.id);
    return (
      at !== undefined &&
      !drafted.has(c.id) &&
      (c.settledAt ?? 0) < at &&
      (c.snoozedAt ?? 0) < at
    );
  };
  const active = new Set(sections.active);
  const key = (c: C) => Math.max(c.updated, raised.get(c.id) ?? 0);
  const clean = (list: C[]) =>
    list.filter((c) => !drafted.has(c.id) && !kept(c));
  return {
    active: [
      ...all.filter((c) => drafted.has(c.id)),
      ...all
        .filter((c) => !drafted.has(c.id) && (active.has(c) || kept(c)))
        .sort((a, b) => key(b) - key(a)),
    ],
    snoozed: clean(sections.snoozed),
    settled: clean(sections.settled),
  };
}
