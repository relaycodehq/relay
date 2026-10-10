// What a phone tells you about while it's in your pocket: a thread that
// finished, failed or asked you something since the last list, worded for a
// notification.
import { agentError } from "./agent-error";
import { agentName } from "./agents";
import { wakeLabel } from "./chat-activity";
import type { ChatMessage } from "./projects";
import type { RemoteChatSummary } from "./remote";

export interface ThreadNews {
  chatId: string;
  kind: "waiting" | "finished" | "failed";
  title: string;
  body: string;
}

/** A thread's latest answer in the main conversation, as its message events left it. */
export type LastAnswer = Pick<
  ChatMessage,
  "status" | "body" | "error" | "provider"
>;

/** What news needs to know of a thread; the desktop's and the phone's lists both have it. */
export type NewsChat = Pick<
  RemoteChatSummary,
  | "id"
  | "title"
  | "provider"
  | "running"
  | "waiting"
  | "limitResume"
  | "snoozedUntil"
  | "seenAt"
  | "updated"
>;

const previewLength = 240;

/**
 * Threads that moved from one list to the next. A thread new to the list
 * isn't news, nor one read where it happened: someone is watching it there.
 */
export function threadNews(
  before: ReadonlyMap<string, NewsChat>,
  now: readonly NewsChat[],
  answers: ReadonlyMap<string, LastAnswer>,
  at = Date.now(),
): ThreadNews[] {
  const news: ThreadNews[] = [];
  for (const c of now) {
    const was = before.get(c.id);
    if (!was || read(c)) continue;
    const agent = c.provider ? agentName(c.provider) : "The agent";
    if (c.waiting && !was.waiting) {
      news.push({
        chatId: c.id,
        kind: "waiting",
        title: c.title,
        body: `${agent} needs you`,
      });
      continue;
    }
    if (c.limitResume && !was.limitResume) {
      news.push({
        chatId: c.id,
        kind: "failed",
        title: c.title,
        body: c.limitResume.off
          ? `${agentName(c.limitResume.provider)} hit its usage limit`
          : `${agentName(c.limitResume.provider)} hit its usage limit · resumes the answer at ${wakeLabel(c.limitResume.at, new Date(at))}`,
      });
      continue;
    }
    if (!was.running || c.running) continue;
    // Snoozed: it comes back by itself when you said.
    if (c.snoozedUntil && c.snoozedUntil > at) continue;
    const answer = answers.get(c.id);
    // An optional question must not hide a failure after the agent kept working.
    if (c.waiting && answer?.status !== "failed") continue;
    // Someone stopped it, so someone knows.
    if (answer?.status === "cancelled") continue;
    news.push(
      answer?.status === "failed"
        ? {
            chatId: c.id,
            kind: "failed",
            title: c.title,
            body: answer.error?.trim()
              ? agentError(answer.error).message
              : `${agent}'s answer failed`,
          }
        : {
            chatId: c.id,
            kind: "finished",
            title: c.title,
            body: (answer && preview(answer.body)) || `${agent} finished`,
          },
    );
  }
  return news;
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
