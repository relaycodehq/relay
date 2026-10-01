import type { ChatSummary } from "./projects";

// Activity triage follows T3 Code's settle/snooze model (thread-settled.ts):
// settling and snoozing are overlays on an open thread, and newer activity
// always outranks them. `updated` moves on every sent message and finished
// answer, so comparing against it is the "raised hand" check.
export type ChatActivitySection = "active" | "snoozed" | "settled";

/** What triage reads; the phone's thread summaries carry just these. */
type Triaged = Pick<
  ChatSummary,
  "running" | "waiting" | "settledAt" | "snoozedAt" | "snoozedUntil" | "updated"
>;

export function chatSettled(chat: Triaged): boolean {
  return (
    !chat.running &&
    !chat.waiting &&
    chat.settledAt != null &&
    chat.settledAt >= chat.updated
  );
}

function chatSnoozed(chat: Triaged, now: number): boolean {
  return (
    !chat.waiting &&
    chat.snoozedUntil != null &&
    chat.snoozedUntil > now &&
    (chat.snoozedAt == null || chat.updated <= chat.snoozedAt)
  );
}

export function chatActivitySection(
  chat: Triaged,
  now: number,
): ChatActivitySection {
  if (chatSettled(chat)) return "settled";
  if (chatSnoozed(chat, now)) return "snoozed";
  return "active";
}

export const DEFAULT_AUTO_SETTLE_DAYS = 3;

type AutoSettled = Triaged &
  Pick<
    ChatSummary,
    | "archivedAt"
    | "unsettledAt"
    | "autoSettleOff"
    | "pending"
    | "nextSend"
    | "heldWakeups"
    | "stopped"
    | "worktree"
  >;

/**
 * When a thread settles by itself, like T3 Code's auto-settle: once its PR
 * merged after the last activity, or after `days` without any; `days` null
 * turns both off. Undefined while anything is still going on in it or about
 * to, and after you moved it back by hand, until something newer happens.
 */
export function autoSettledAt(
  chat: AutoSettled,
  now: number,
  days: number | null,
): number | undefined {
  if (
    days == null ||
    chat.archivedAt ||
    chat.autoSettleOff ||
    chat.running ||
    chat.waiting ||
    chatSettled(chat) ||
    (chat.unsettledAt ?? 0) >= chat.updated ||
    chatSnoozed(chat, now) ||
    chat.pending?.length ||
    chat.nextSend ||
    chat.heldWakeups?.length ||
    chat.stopped
  )
    return undefined;
  const merged = chat.worktree?.landed?.at;
  if (merged && merged > chat.updated) return merged;
  // Backdated to the last activity, so the shelf orders by when work stopped.
  if (now - chat.updated >= days * 86_400_000) return chat.updated;
  return undefined;
}

/** Only the latest settled threads stay in Activity; Projects lists them all. */
const SETTLED_SHELF_SIZE = 15;

export function chatActivitySections<C extends Triaged>(
  chats: C[],
  now: number,
) {
  const sections: Record<ChatActivitySection, C[]> = {
    active: [],
    snoozed: [],
    settled: [],
  };
  for (const c of chats) sections[chatActivitySection(c, now)].push(c);
  // Latest settled first: a thread settled just now stays there to undo, even
  // when its last message is older than the rest.
  sections.settled = sections.settled
    .sort((a, b) => b.settledAt! - a.settledAt!)
    .slice(0, SETTLED_SHELF_SIZE);
  return sections;
}

/** Empty threads (e.g. an unused PR thread) only clutter the lists. */
export function chatIsEmpty(chat: ChatSummary): boolean {
  return (chat.empty ?? chat.updated === chat.created) && !chat.shared;
}

export interface SnoozePreset {
  id: "hour" | "three-hours" | "evening" | "tomorrow" | "next-week";
  label: string;
  until: number;
}

/** `hour`:00 local time, `days` after `base`'s date. */
export function atHour(base: Date, days: number, hour: number): number {
  // Calendar-day advance keeps the wake hour stable across DST changes.
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  next.setHours(hour, 0, 0, 0);
  return next.getTime();
}

export function snoozePresets(now: Date): SnoozePreset[] {
  const presets: SnoozePreset[] = [
    { id: "hour", label: "1 hour", until: now.getTime() + 3_600_000 },
    { id: "three-hours", label: "3 hours", until: now.getTime() + 10_800_000 },
  ];
  // Only offer "this evening" while it is still meaningfully ahead.
  if (now.getHours() < 17)
    presets.push({
      id: "evening",
      label: "This evening",
      until: atHour(now, 0, 18),
    });
  presets.push({
    id: "tomorrow",
    label: "Tomorrow",
    until: atHour(now, 1, 9),
  });
  const toMonday = (8 - now.getDay()) % 7 || 7;
  presets.push({
    id: "next-week",
    label: "Next week",
    until: atHour(now, toMonday, 9),
  });
  return presets;
}

/**
 * Whether a thread moved since it was read: on this device (`seen`, by id),
 * anywhere (`seenAt`), or before this device first looked (`since`).
 */
export const movedSinceSeen = (
  chat: Pick<ChatSummary, "id" | "updated" | "seenAt">,
  since: number,
  seen: Record<string, number>,
) => chat.updated > Math.max(since, seen[chat.id] ?? 0, chat.seenAt ?? 0);

/** Send later's quick choices, on the desktop and the phone. */
export function sendLaterPresets(now: Date): { label: string; at: number }[] {
  const presets = [
    { label: "In 30 minutes", at: now.getTime() + 1_800_000 },
    { label: "In 1 hour", at: now.getTime() + 3_600_000 },
    { label: "In 3 hours", at: now.getTime() + 10_800_000 },
  ];
  if (now.getHours() < 17)
    presets.push({ label: "This evening", at: atHour(now, 0, 18) });
  presets.push({ label: "Tomorrow morning", at: atHour(now, 1, 9) });
  return presets;
}

/** "17:30", "tomorrow 9:00", "Mon 9:00", "Oct 3, 9:00". */
export function wakeLabel(until: number, now: Date): string {
  const wake = new Date(until);
  const time = wake.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const midnight = (date: Date) => new Date(date).setHours(0, 0, 0, 0);
  // Rounded: a day the clocks change on lasts 23 or 25 hours.
  const days = Math.round((midnight(wake) - midnight(now)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7)
    return `${wake.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${wake.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** When a message was sent: "13:25", "Yesterday 13:25", "Tuesday 13:25", "Sep 3, 13:25". */
export function sentLabel(sent: number, now: Date): string {
  const at = new Date(sent);
  const time = at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const midnight = (date: Date) => new Date(date).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7)
    return `${at.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  const date = at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `${date}, ${time}`;
}

/** How long a running turn has gone, by the second: "26s", "4m 12s", "1h 3m". */
export function elapsedLabel(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}

/** Compact age for sidebar rows: "now", "4m", "3h", "2d", "5w". */
export function shortAge(then: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
