// The outbox's rules, apart from the disk and the link it works through.
import type { ChatMessage, ProjectChatSend } from "../../../shared/projects";

export interface Outgoing {
  /** The paired computer it's for; it only ever goes to that one. */
  computer: string;
  chatId: string;
  send: ProjectChatSend;
  created: number;
  /** The desktop took it, at this `stamp()`; it goes once the thread holds it. */
  sent?: number;
  error?: string;
  /** No answer came back, so the desktop may have it all the same. */
  unsure?: boolean;
}

let clock = 0;
/** Orders the desktop's answers to sends against the thread fetches made on this phone. */
export const stamp = () => ++clock;

/** A thread as the desktop sends or the phone holds it: messages in full or by id. */
interface Holding {
  messages: (ChatMessage | string)[];
  queue?: { id: string }[];
  scheduled?: { id: string }[];
}

/** Every send the thread holds: as a message, waiting in its queue, or sent with Send later. */
export function heldIds(thread: Holding | undefined): ReadonlySet<string> {
  if (!thread) return new Set();
  return new Set([
    ...thread.messages.map((m) => (typeof m === "string" ? m : m.id)),
    ...(thread.queue ?? []).map((q) => q.id),
    ...(thread.scheduled ?? []).map((s) => s.id),
  ]);
}

/**
 * The sends done with once thread `chatId` reads as `held`, from a fetch made
 * at `fetched`: the ones it holds, and the ones the desktop took before that
 * fetch but which it holds nowhere any more (a queued one taken back out, a
 * `/goal pause` that leaves no message).
 */
export const settled = (
  items: readonly Outgoing[],
  computer: string,
  chatId: string,
  held: ReadonlySet<string>,
  fetched: number,
) =>
  items.filter(
    (o) =>
      o.computer === computer &&
      o.chatId === chatId &&
      (held.has(o.send.id) || (!!o.sent && o.sent < fetched)),
  );

/** How the thread shows one until the desktop's copy arrives. */
export const outgoingMessage = (o: Outgoing): ChatMessage => ({
  id: o.send.id,
  role: "user",
  body: o.send.body,
  status: "complete",
  created: o.created,
  provider: o.send.provider,
  version: 0,
  pending: true,
  ...(o.error
    ? {
        error: o.unsure ? `Maybe not sent: ${o.error}` : `Not sent: ${o.error}`,
      }
    : {}),
  ...(o.send.images?.length
    ? {
        images: o.send.images.map((image, i) => ({
          id: `${o.send.id}:${i}`,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: Math.round((image.dataUrl.length * 3) / 4),
        })),
      }
    : {}),
  ...(o.send.parentId ? { parentId: o.send.parentId } : {}),
  ...(o.send.side ? { side: true } : {}),
});
