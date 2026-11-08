import { useSyncExternalStore } from "react";
import type { ProjectChat, ProjectChatSend } from "../../../shared/projects";

/**
 * Messages sent from this window that the thread doesn't hold yet. A send
 * right after Stop waits for the agent to let go, which can take seconds;
 * without these the message would vanish from the composer and show nowhere.
 */
export interface SendingMessage {
  input: ProjectChatSend;
  at: number;
}

/** A quick send lands before this, so it never shows twice. */
const SHOWN_AFTER = 250;

const byThread = new Map<string, SendingMessage[]>();
const listeners = new Set<() => void>();
const none: SendingMessage[] = [];

function set(threadId: string, list: SendingMessage[]) {
  if (list.length) byThread.set(threadId, list);
  else byThread.delete(threadId);
  for (const listener of listeners) listener();
}

/** Shows `input` in its thread while `send` runs, if it runs long enough to be missed. */
export async function showWhileSending<T>(
  threadId: string,
  input: ProjectChatSend,
  send: () => Promise<T>,
) {
  const show = setTimeout(() => {
    const entry = { input, at: Date.now() };
    set(threadId, [...(byThread.get(threadId) ?? []), entry]);
  }, SHOWN_AFTER);
  try {
    return await send();
  } finally {
    clearTimeout(show);
    const list = byThread.get(threadId) ?? [];
    if (list.some((s) => s.input.id === input.id))
      set(
        threadId,
        list.filter((s) => s.input.id !== input.id),
      );
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The thread has the message already: sent, queued or scheduled. */
const holds = (thread: ProjectChat, id: string) =>
  [
    ...thread.messages,
    ...(thread.queue ?? []).map((q) => q.input),
    ...(thread.scheduled ?? []).map((s) => s.input),
  ].some((m) => m.id === id);

/** What's being sent to the conversation under `rootId` (the main one without) that the thread doesn't show yet. */
export function useSendingMessages(
  threadId: string | undefined,
  thread: ProjectChat | undefined,
  rootId: string | undefined,
) {
  const sending = useSyncExternalStore(
    subscribe,
    () => (threadId && byThread.get(threadId)) || none,
  );
  return sending.filter(
    (s) =>
      (s.input.parentId ?? undefined) === rootId &&
      !(thread && holds(thread, s.input.id)),
  );
}
