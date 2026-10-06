import type { ChatMessage, ChatSummary, ChatTriageState } from "./projects";

// Settling and snoozing are overlays on an open thread, and newer activity
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
/**
 * How long a thread stays quiet after its agent committed before it settles.
 * In Relay's own threads a shorter wait settled most of the ones you came
 * back to with "still broken" a few minutes later.
 */
export const COMMIT_QUIET_MS = 15 * 60_000;

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
    | "committedAt"
  >;

/**
 * When a thread settles by itself: once its PR merged after the last
 * activity, or after `days` without any; `days` null
 * turns both off. `onCommit` also settles it once its latest turn committed
 * and it stayed quiet for `COMMIT_QUIET_MS`.
 * Undefined while anything is still going on in it or about to, and after
 * you moved it back by hand, until something newer happens.
 */
export function autoSettledAt(
  chat: AutoSettled,
  now: number,
  days: number | null,
  onCommit = false,
): number | undefined {
  return autoSettle(chat, now, days, onCommit)?.at;
}

/**
 * When a thread moved to Settled, by hand or by itself; undefined while it
 * isn't settled. Unlike the shelf's backdated `settledAt`, this is the moment
 * it settled, so waiting a set time after settling starts there.
 */
export function settledSince(
  chat: AutoSettled,
  now: number,
  days: number | null,
  onCommit = false,
): number | undefined {
  if (chatSettled(chat)) return chat.settledAt;
  return autoSettle(chat, now, days, onCommit)?.since;
}

/** `at` is what the shelf orders by; `since` is when the thread moved there. */
function autoSettle(
  chat: AutoSettled,
  now: number,
  days: number | null,
  onCommit: boolean,
): { at: number; since: number } | undefined {
  if (
    (days == null && !onCommit) ||
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
  // The answer that committed is the latest activity; anything after it isn't.
  if (
    onCommit &&
    chat.committedAt &&
    chat.committedAt >= chat.updated &&
    now - chat.committedAt >= COMMIT_QUIET_MS
  )
    return { at: chat.committedAt, since: chat.committedAt + COMMIT_QUIET_MS };
  if (days == null) return undefined;
  const merged = chat.worktree?.landed?.at;
  if (merged && merged > chat.updated) return { at: merged, since: merged };
  // Backdated to the last activity, so the shelf orders by when work stopped.
  const quiet = days * 86_400_000;
  if (now - chat.updated >= quiet)
    return { at: chat.updated, since: chat.updated + quiet };
  return undefined;
}

const triageKeys = [
  "settledAt",
  "unsettledAt",
  "snoozedAt",
  "snoozedUntil",
  "archivedAt",
] as const;

/** The marks triage set on `chat`; a settle worked out live isn't one. */
export function triageState(
  chat: ChatTriageState & Pick<ChatSummary, "autoSettled">,
): ChatTriageState {
  const state: ChatTriageState = {};
  for (const key of triageKeys)
    if (chat[key] != null && !(key === "settledAt" && chat.autoSettled))
      state[key] = chat[key];
  return state;
}

export const sameTriageState = (a: ChatTriageState, b: ChatTriageState) =>
  triageKeys.every((key) => a[key] === b[key]);

/** Gives `chat` exactly `state`'s marks, dropping the ones it had. */
export function setTriageState(chat: ChatTriageState, state: ChatTriageState) {
  for (const key of triageKeys)
    if (state[key] == null) delete chat[key];
    else chat[key] = state[key];
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

const HOUR_MS = 3_600_000;

/**
 * Local `hour`:00 on the day `days` calendar days after `from`. Counting
 * calendar days rather than 24-hour steps keeps the hour across DST changes.
 */
function dayAt(from: Date, days: number, hour: number): number {
  return new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + days,
    hour,
  ).getTime();
}

/** Days to the coming Monday; a Monday waits for the next one. */
const daysToMonday = (date: Date) => 7 - ((date.getDay() + 6) % 7);

export function snoozePresets(now: Date): SnoozePreset[] {
  const choices: (SnoozePreset | false)[] = [
    { id: "hour", label: "1 hour", until: now.getTime() + HOUR_MS },
    { id: "three-hours", label: "3 hours", until: now.getTime() + 3 * HOUR_MS },
    // Past five the evening is too close to be worth a choice of its own.
    now.getHours() < 17 && {
      id: "evening",
      label: "This evening",
      until: dayAt(now, 0, 18),
    },
    { id: "tomorrow", label: "Tomorrow", until: dayAt(now, 1, 9) },
    {
      id: "next-week",
      label: "Next week",
      until: dayAt(now, daysToMonday(now), 9),
    },
  ];
  return choices.filter((choice) => choice !== false);
}

/**
 * How far a thread has been read: on this device (`seen`, by id), anywhere
 * (`seenAt`), or before this device first looked (`since`).
 */
export const readUpTo = (
  chat: Pick<ChatSummary, "id" | "seenAt">,
  since: number,
  seen: Record<string, number>,
) => Math.max(since, seen[chat.id] ?? 0, chat.seenAt ?? 0);

/** Whether a thread moved since it was read; see readUpTo. */
export const movedSinceSeen = (
  chat: Pick<ChatSummary, "id" | "updated" | "seenAt">,
  since: number,
  seen: Record<string, number>,
) => chat.updated > readUpTo(chat, since, seen);

/** A stretch the open thread went unwatched: from where it was read up to, to when you came back. */
export interface AwayWindow {
  from: number;
  to: number;
}

/**
 * Where a thread's "New" divider goes: above the first message that started
 * or finished while you were away, which `since` says when you'd read up to.
 * A message that started and ended while you watched is not new, even below
 * the divider. Your own messages and Relay's notes about the session (a
 * compaction, a reload, a worktree's setup) are never what's new. None when nothing is new, or
 * when the divider would sit above the first message and so separate nothing.
 */
export function unreadStart(
  messages: (Pick<ChatMessage, "id" | "created" | "ended"> &
    Partial<
      Pick<
        ChatMessage,
        "role" | "author" | "compaction" | "reload" | "worktreeCommand"
      >
    >)[],
  away: AwayWindow[],
): { id: string; since: number } | undefined {
  const during = (at: number | undefined) =>
    at === undefined ? undefined : away.find((w) => at > w.from && at <= w.to);
  for (const [index, m] of messages.entries()) {
    if (
      (m.role === "user" && !m.author) ||
      m.compaction ||
      m.reload ||
      m.worktreeCommand
    )
      continue;
    const gap = during(m.created) ?? during(m.ended);
    if (gap) return index ? { id: m.id, since: gap.from } : undefined;
  }
}

/** Send later's quick choices, on the desktop and the phone. */
export function sendLaterPresets(now: Date): { label: string; at: number }[] {
  const presets = [
    { label: "In 30 minutes", at: now.getTime() + 1_800_000 },
    { label: "In 1 hour", at: now.getTime() + 3_600_000 },
    { label: "In 3 hours", at: now.getTime() + 10_800_000 },
  ];
  if (now.getHours() < 17)
    presets.push({ label: "This evening", at: dayAt(now, 0, 18) });
  presets.push({ label: "Tomorrow morning", at: dayAt(now, 1, 9) });
  return presets;
}

/** Midnights from `from`'s date to `to`'s, negative when `to` is earlier. */
function calendarDays(from: Date, to: Date) {
  const midnight = (date: Date) => new Date(date).setHours(0, 0, 0, 0);
  // Rounded: a day the clocks change on lasts 23 or 25 hours.
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

/** "17:30", "tomorrow 9:00", "Mon 9:00", "Oct 3, 9:00". */
export function wakeLabel(until: number, now: Date): string {
  const wake = new Date(until);
  const ahead = calendarDays(now, wake);
  const day =
    ahead <= 0
      ? ""
      : ahead === 1
        ? "tomorrow "
        : ahead < 7
          ? `${wake.toLocaleDateString(undefined, { weekday: "short" })} `
          : `${wake.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, `;
  return (
    day +
    wake.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

/** When a message was sent: "13:25", "Yesterday 13:25", "Tuesday 13:25", "Sep 3, 13:25". */
export function sentLabel(sent: number, now: Date): string {
  const at = new Date(sent);
  const time = at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const days = calendarDays(at, now);
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
