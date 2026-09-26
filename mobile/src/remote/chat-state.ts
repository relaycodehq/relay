import type { ChatMessage, KnownMessages } from "../../../shared/projects";
import type { RemoteChat } from "../../../shared/remote";

/** A thread as the phone holds it: every message in full. */
export interface Thread extends Omit<RemoteChat, "messages"> {
  messages: ChatMessage[];
}

export const knownOf = (thread: Thread | undefined): KnownMessages | undefined =>
  thread && Object.fromEntries(thread.messages.map((m) => [m.id, m.version]));

/**
 * Fills in the messages the desktop only named, from what the phone already
 * holds. A name the phone doesn't hold means its copy is gone: fetch again
 * without `known`.
 */
export function applyPatch(previous: Thread | undefined, patch: RemoteChat): Thread {
  const held = new Map(previous?.messages.map((m) => [m.id, m]));
  return {
    ...patch,
    messages: patch.messages.map((m) => {
      if (typeof m !== "string") return m;
      const kept = held.get(m);
      if (!kept) throw new MissingMessage();
      return kept;
    }),
  };
}

export class MissingMessage extends Error {}

/** A streamed update; an older version than the phone holds is dropped. */
export function applyMessage(thread: Thread, message: ChatMessage): Thread {
  const at = thread.messages.findIndex((m) => m.id === message.id);
  if (at >= 0 && thread.messages[at]!.version > message.version) return thread;
  const messages =
    at >= 0
      ? thread.messages.map((m, i) => (i === at ? message : m))
      : [...thread.messages, message].sort(order);
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

const order = (a: ChatMessage, b: ChatMessage) =>
  a.seq && b.seq
    ? a.seq - b.seq
    : a.seq
      ? -1
      : b.seq
        ? 1
        : a.created - b.created;

/** The main conversation; side questions and their replies stay on the desktop for now. */
export const mainMessages = (messages: ChatMessage[]) =>
  messages.filter((m) => !m.side && !m.parentId);
