// What a thread is news of, decided once on the computer for the window's
// sounds, the menubar's and the phone's notifications alike: an answer that
// finished or failed, a thread that needs you. See docs/turn-lifecycle.md.
import { agentError } from "./agent-error";
import { agentName } from "./agents";
import type { ChatMessage } from "./projects";
import type { RemoteChatSummary } from "./remote";
import { answersKinds, type Turn } from "./turns";

export interface ThreadNews {
  chatId: string;
  kind: "waiting" | "finished" | "failed";
  title: string;
  body: string;
}

/** A thread's latest answer in the main conversation, as its message events left it. */
export type LastAnswer = Pick<ChatMessage, "body" | "error">;

/** What news needs to know of a thread, as its list entry has it. */
export type NewsChat = Pick<
  RemoteChatSummary,
  | "id"
  | "title"
  | "provider"
  | "waiting"
  | "snoozedUntil"
  | "settledAt"
  | "settleWhenDone"
  | "seenAt"
  | "updated"
>;

const previewLength = 240;

/** News as the computer told it: numbered, so a phone that was away asks for what it missed. */
export type NewsItem = ThreadNews & {
  seq: number;
  at: number;
  projectId: string;
  /** The turn whose end it is; a question has none. */
  turnId?: string;
  /** The thread was started by an agent, which is the one waiting on it. */
  byAgent?: true;
};
/** Where a client is in the computer's news; `epoch` changes when Relay restarts. */
export interface NewsCursor {
  epoch: string;
  seq: number;
}
/** What a client missed since its cursor, or no `items` when it's too far behind to say. */
export type NewsCatchUp = NewsCursor & { items?: NewsItem[] };

/**
 * What a turn's end is news of, by the thread as it reads now: a finished or
 * failed answer, never a compaction, a note or a side answer, nor an answer
 * someone stopped. Whether someone watched it run can't be told yet, since a
 * window marks it read only after it went idle: a window's sounds skip the
 * thread it shows, and a phone keeps quiet while someone is at the computer.
 */
export function answerNews(
  turn: Pick<Turn, "kind" | "endedAs" | "startedAt" | "provider">,
  chat: NewsChat,
  answer: LastAnswer | undefined,
  at = Date.now(),
): ThreadNews | undefined {
  if (!answersKinds.includes(turn.kind)) return;
  const failed = turn.endedAs === "failed";
  if (!failed && turn.endedAs !== "completed") return;
  // Snoozed: it comes back by itself when you said.
  if (chat.snoozedUntil && chat.snoozedUntil > at) return;
  const agent = agentName(turn.provider);
  if (failed)
    return {
      chatId: chat.id,
      kind: "failed",
      title: chat.title,
      body: answer?.error?.trim()
        ? agentError(answer.error).message
        : `${agent}'s answer failed`,
    };
  // An optional question must not hide a failure, but a finished answer waits for it.
  if (chat.waiting) return;
  // Settled while it ran: it finishes out of sight, and news of it would
  // leave you guessing which thread it was. A failure comes back to Activity.
  if (
    chat.settleWhenDone != null ||
    (chat.settledAt != null && chat.settledAt >= turn.startedAt)
  )
    return;
  return {
    chatId: chat.id,
    kind: "finished",
    title: chat.title,
    body: (answer && preview(answer.body)) || `${agent} finished`,
  };
}

/**
 * A thread that started needing you since the last list, where `wasWaiting`
 * is how that list had it; one new to the list isn't news.
 */
export function waitingNews(
  wasWaiting: boolean | undefined,
  chat: NewsChat,
): ThreadNews | undefined {
  if (wasWaiting !== false || !chat.waiting || read(chat)) return;
  const agent = chat.provider ? agentName(chat.provider) : "The agent";
  return {
    chatId: chat.id,
    kind: "waiting",
    title: chat.title,
    body: `${agent} needs you`,
  };
}

/** Threads read since the last list, on the computer or another phone, whose notification can go. */
export function threadsRead(
  before: ReadonlyMap<string, RemoteChatSummary>,
  now: readonly RemoteChatSummary[],
) {
  return now.filter((c) => read(c) && !read(before.get(c.id))).map((c) => c.id);
}

const read = (c: Pick<RemoteChatSummary, "seenAt" | "updated"> | undefined) =>
  !!c?.seenAt && c.seenAt >= c.updated;

/**
 * The start of an answer as plain words: no fences, marks or link targets. A
 * heading runs into what follows it, so it gets a colon.
 */
export function preview(markdown: string, length = previewLength) {
  const text = markdown
    .replace(/```[^\n]*\n[\s\S]*?(```|$)/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$(?=\n\s*\S)/gm, (_, heading: string) =>
      /[.:!?]$/.test(heading) ? heading : `${heading}:`,
    )
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length
    ? `${text.slice(0, length - 1).trimEnd()}…`
    : text;
}
