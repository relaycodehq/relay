// Clip's tips: which one peeks up beside a long turn's thinking line, and how
// often Clip may peek at all: once a day per thread, and a rest after peeks
// nobody so much as pointed at.
import { tips as allTips, type TipFacts } from "./tip-list";

const DAY = 86_400_000;
/** A turn runs this long before Clip peeks: shorter ones have no dead time. */
export const PEEK_AFTER = 20_000;
/** Peeks per tip, ever. */
export const MAX_SHOWS = 2;
/** Between two peeks with the same tip. */
export const SHOW_COOLDOWN = 3 * DAY;
/** Peeks in a row nobody pointed at before Clip rests. */
export const IGNORED_LIMIT = 5;
/** Between two peeks in one thread. */
export const THREAD_REST = DAY;
export const REST = 3 * DAY;
/** After the × on a tip. */
export const SNOOZE = DAY;
const PEEKS_KEPT = 300;

export type TipMemory = {
  introSeen?: true;
  shown: Partial<Record<string, { count: number; last: number }>>;
  /** Acted on, or hidden for good from the right-click menu: these don't come back. */
  done: string[];
  /** The last turn Clip peeked over in each thread, newest last. */
  peeked: Peek[];
  /** Peeks in a row nobody pointed at. */
  ignored: number;
  /** No new peeks till then; a turn already peeked over keeps its peek. */
  restUntil?: number;
  /** The × on a tip: Clip stays down till then, even over a turn he's up on. */
  snoozedUntil?: number;
};

/** [thread, message, when]; saves from before the time have none. */
type Peek = [string, string, number?];

export const emptyMemory: TipMemory = {
  shown: {},
  done: [],
  peeked: [],
  ignored: 0,
};

/** One turn a day per thread; the turn it already peeked over keeps its peek, unless snoozed. */
export function canPeek(
  m: TipMemory,
  chatId: string,
  messageId: string,
  now: number,
) {
  if (isSnoozed(m, now)) return false;
  const before = m.peeked.find(([chat]) => chat === chatId);
  if (before?.[1] === messageId) return true;
  if (before && now - (before[2] ?? 0) < THREAD_REST) return false;
  return (m.restUntil ?? 0) <= now;
}

/** The least-shown tip that still applies, in list order on a tie. */
export function pickTip(
  m: TipMemory,
  facts: TipFacts,
  now: number,
  tips = allTips,
) {
  const open = tips.filter((tip) => {
    const seen = m.shown[tip.id];
    return (
      tip.relevant(facts) &&
      !m.done.includes(tip.id) &&
      (!seen || (seen.count < MAX_SHOWS && now - seen.last >= SHOW_COOLDOWN))
    );
  });
  return open.sort(
    (a, b) => (m.shown[a.id]?.count ?? 0) - (m.shown[b.id]?.count ?? 0),
  )[0];
}

/** Clip peeked over a turn with a tip, which shows it right there. */
export function recordPeek(
  m: TipMemory,
  chatId: string,
  messageId: string,
  tipId: string,
  now: number,
): TipMemory {
  if (m.peeked.some(([c, id]) => c === chatId && id === messageId)) return m;
  const ignored = m.ignored + 1;
  const tired = ignored >= IGNORED_LIMIT;
  return {
    ...recordShown(m, tipId, now),
    peeked: [
      ...m.peeked.filter(([c]) => c !== chatId),
      [chatId, messageId, now] as Peek,
    ].slice(-PEEKS_KEPT),
    ignored: tired ? 0 : ignored,
    restUntil: tired ? now + REST : m.restUntil,
  };
}

export function recordShown(m: TipMemory, id: string, now: number): TipMemory {
  const count = (m.shown[id]?.count ?? 0) + 1;
  return { ...m, shown: { ...m.shown, [id]: { count, last: now } } };
}

/** The pointer came to Clip: he isn't being ignored. */
export const recordNoticed = (m: TipMemory): TipMemory =>
  m.ignored ? { ...m, ignored: 0 } : m;

/** × on a tip: Clip stays down for a day, and the tip may come back after. */
export const recordSnooze = (m: TipMemory, now: number): TipMemory => ({
  ...m,
  ignored: 0,
  snoozedUntil: now + SNOOZE,
});

export const isSnoozed = (m: TipMemory, now: number) =>
  (m.snoozedUntil ?? 0) > now;

export function recordDone(m: TipMemory, id: string): TipMemory {
  return m.done.includes(id) ? m : { ...m, done: [...m.done, id] };
}

/** Saved memory, or an empty one for anything missing or malformed. */
export function parseMemory(saved: unknown): TipMemory {
  if (!saved || typeof saved !== "object") return emptyMemory;
  const m = saved as Partial<TipMemory>;
  return {
    introSeen: m.introSeen === true ? true : undefined,
    shown: m.shown && typeof m.shown === "object" ? m.shown : {},
    done: Array.isArray(m.done)
      ? m.done.filter((id) => typeof id === "string")
      : [],
    peeked: Array.isArray(m.peeked)
      ? m.peeked.filter(
          (p): p is Peek =>
            Array.isArray(p) &&
            typeof p[0] === "string" &&
            typeof p[1] === "string" &&
            (p[2] === undefined || typeof p[2] === "number"),
        )
      : [],
    ignored: typeof m.ignored === "number" ? m.ignored : 0,
    restUntil: typeof m.restUntil === "number" ? m.restUntil : undefined,
    snoozedUntil:
      typeof m.snoozedUntil === "number" ? m.snoozedUntil : undefined,
  };
}
