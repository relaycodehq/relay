import { replyRoot, type ChatMessage } from "../../shared/projects";

/** What a side question's thread holds, for the bar under it. */
export interface SideThread {
  replies: number;
  last: number;
  answering: boolean;
}

/** The fetched messages with any newer streamed copies, in thread order. */
export function withUpdates(
  fetched: ChatMessage[],
  updates: Record<string, ChatMessage>,
) {
  const byId = new Map(fetched.map((m) => [m.id, m]));
  for (const m of Object.values(updates))
    if (!byId.has(m.id) || byId.get(m.id)!.version <= m.version)
      byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.seq && b.seq
      ? a.seq - b.seq
      : a.seq
        ? -1
        : b.seq
          ? 1
          : a.created - b.created,
  );
}

/** Each reply's side conversation, by the message it starts from. A broken
 * chain keeps the reply under its direct parent. */
export function replyRoots(messages: ChatMessage[]) {
  const roots = new Map<string, string>();
  for (const m of messages)
    if (m.parentId)
      try {
        roots.set(m.id, replyRoot(messages, m.id).id);
      } catch {
        roots.set(m.id, m.parentId);
      }
  return roots;
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

/** The side conversation from `rootId`, or else the main one. A reply whose
 * parent is gone shows in the main one rather than nowhere. */
export function conversation(
  messages: ChatMessage[],
  roots: Map<string, string>,
  rootId: string | undefined,
) {
  const ids = new Set(messages.map((m) => m.id));
  return messages.filter((m) =>
    rootId
      ? m.id === rootId || roots.get(m.id) === rootId
      : !m.parentId || !ids.has(m.parentId),
  );
}
