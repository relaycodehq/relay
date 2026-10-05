// Activity's rules for the sidebar: how triage shows before the desktop has
// it, where settling the open thread moves on to, and what the bell counts.
import type { ChatSummary, ChatTriage } from "../../../shared/projects";
import { setTriageState } from "../../../shared/chat-activity";

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
 * Activity's cards: threads another thread's agent started sit under their
 * lead, in the order they were started. A settled lead whose threads still
 * show comes back as a header above them, where the first of them would be;
 * `cards` is `top` without those headers.
 */
export function startedFamilies(
  active: ChatSummary[],
  settled: ChatSummary[] = [],
) {
  const listed = new Set(active.map((c) => c.id));
  const resting = new Map(settled.map((c) => [c.id, c]));
  const started = new Map<string, ChatSummary[]>();
  for (const c of active) {
    const lead = c.startedBy?.chatId;
    if (lead && (listed.has(lead) || resting.has(lead)))
      started.set(lead, [...(started.get(lead) ?? []), c]);
  }
  for (const children of started.values())
    children.sort((a, b) => a.created - b.created);
  const top: ChatSummary[] = [];
  const headers = new Set<string>();
  for (const c of active) {
    const lead = c.startedBy?.chatId ?? "";
    if (!started.has(lead)) top.push(c);
    else if (resting.has(lead) && !headers.has(lead)) {
      headers.add(lead);
      top.push(resting.get(lead)!);
    }
  }
  return {
    top,
    cards: top.filter((c) => !headers.has(c.id)),
    started,
    /** Settled leads shown as headers, which the Settled shelf leaves out. */
    headers,
  };
}
export type StartedFamilies = ReturnType<typeof startedFamilies>;

/** "4 threads · 1 working · 1 needs you", on the lead's card. */
export function familyLine(started: ChatSummary[]) {
  const asking = started.filter((c) => c.waiting).length;
  const working = started.filter((c) => c.running && !c.waiting).length;
  return [
    `${started.length} thread${started.length === 1 ? "" : "s"}`,
    working && `${working} working`,
    asking && `${asking} need${asking === 1 ? "s" : ""} you`,
    !working && !asking && "all done",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Every thread in the family is done and read: it folds until something happens. */
export const familySettled = (
  started: ChatSummary[],
  unread: (c: ChatSummary) => boolean,
) =>
  started.every(
    (c) => !c.running && !c.waiting && !c.pending?.length && !unread(c),
  );
