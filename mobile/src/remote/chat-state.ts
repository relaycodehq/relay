import { applyChatPatch, mainConversation, replyRoots, threadOrder, type ChatMessage } from "../../../shared/projects";
import type { RemoteChat } from "../../../shared/remote";

export { knownOf, MissingMessage, rootOf } from "../../../shared/projects";

/** A thread as the phone holds it: every message in full. */
export interface Thread extends Omit<RemoteChat, "messages"> {
  messages: ChatMessage[];
}

/**
 * Fills in the messages the desktop only named, from what the phone already
 * holds. A name the phone doesn't hold means its copy is gone: fetch again
 * without `known`.
 */
export const applyPatch = (previous: Thread | undefined, patch: RemoteChat): Thread =>
  applyChatPatch(patch, previous);

/** A streamed update; an older version than the phone holds is dropped. */
export function applyMessage(thread: Thread, message: ChatMessage): Thread {
  const at = thread.messages.findIndex((m) => m.id === message.id);
  if (at >= 0 && thread.messages[at]!.version > message.version) return thread;
  const messages =
    at >= 0
      ? thread.messages.map((m, i) => (i === at ? message : m))
      : [...thread.messages, message].sort(threadOrder);
  return { ...thread, messages };
}

/** A fetched thread, keeping any message a stream moved past while the fetch ran. */
export function keepNewer(fetched: Thread, held: Thread | undefined): Thread {
  if (!held) return fetched;
  const newer = new Map(held.messages.map((m) => [m.id, m]));
  return {
    ...fetched,
    messages: fetched.messages.map((m) => {
      const h = newer.get(m.id);
      return h && h.version > m.version ? h : m;
    }),
  };
}

/** The main conversation: every message but replies, with `/btw` questions in line. */
export const mainMessages = mainConversation;

/** A side conversation: its root, then the replies under it in order. */
export function sideConversation(messages: ChatMessage[], rootId: string) {
  const roots = replyRoots(messages);
  return messages.filter((m) => m.id === rootId || roots.get(m.id) === rootId);
}

/** How many replies each root has. */
export function replyCounts(messages: ChatMessage[]) {
  const counts = new Map<string, number>();
  for (const root of replyRoots(messages).values())
    counts.set(root, (counts.get(root) ?? 0) + 1);
  return counts;
}
