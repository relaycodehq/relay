import type { ChatSummary } from "./projects";

// Activity triage follows T3 Code's settle/snooze model (thread-settled.ts):
// settling and snoozing are overlays on an open thread, and newer activity
// always outranks them. `updated` moves on every sent message and finished
// answer, so comparing against it is the "raised hand" check.
export type ChatActivitySection = "active" | "snoozed" | "settled";

export function chatSettled(chat: ChatSummary): boolean {
  return (
    !chat.running &&
    !chat.waiting &&
    chat.settledAt != null &&
    chat.settledAt >= chat.updated
  );
}

export function chatSnoozed(chat: ChatSummary, now: number): boolean {
  return (
    !chat.waiting &&
    chat.snoozedUntil != null &&
    chat.snoozedUntil > now &&
    (chat.snoozedAt == null || chat.updated <= chat.snoozedAt)
  );
}

export function chatActivitySection(
  chat: ChatSummary,
  now: number,
): ChatActivitySection {
  if (chatSettled(chat)) return "settled";
  if (chatSnoozed(chat, now)) return "snoozed";
  return "active";
}

/** Only the latest settled threads stay in Activity; Projects lists them all. */
export const SETTLED_SHELF_SIZE = 15;

export function chatActivitySections(chats: ChatSummary[], now: number) {
  const sections: Record<ChatActivitySection, ChatSummary[]> = {
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

function atHour(base: Date, days: number, hour: number): number {
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
