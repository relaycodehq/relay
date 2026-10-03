import { mainConversation, type ChatMessage } from "../../../shared/projects";

/** What a side question's thread holds, for the bar under it. */
export interface SideThread {
  replies: number;
  last: number;
  answering: boolean;
}

export function replyCounts(roots: Map<string, string>) {
  const counts = new Map<string, number>();
  for (const id of roots.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** The bar under each side question: how many replies, when the last came. */
export function sideThreads(
  messages: ChatMessage[],
  roots: Map<string, string>,
) {
  const threads = new Map<string, SideThread>();
  for (const m of messages)
    if (m.side)
      threads.set(m.id, { replies: 0, last: m.created, answering: false });
  for (const m of messages) {
    const thread = threads.get(roots.get(m.id) ?? "");
    if (!thread) continue;
    if (m.status === "streaming") thread.answering = true;
    else {
      thread.replies++;
      thread.last = Math.max(thread.last, m.ended ?? m.created);
    }
  }
  return threads;
}

/** The side conversation from `rootId`, or else the main one. */
export function conversation(
  messages: ChatMessage[],
  roots: Map<string, string>,
  rootId: string | undefined,
) {
  if (!rootId) return mainConversation(messages);
  return messages.filter((m) => m.id === rootId || roots.get(m.id) === rootId);
}
