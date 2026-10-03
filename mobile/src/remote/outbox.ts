// Messages on their way to the desktop. A send can take a while (a worktree
// to make, images to carry over a slow link), so the thread shows the message
// at once and the composer is free again; a send that fails stays in the
// thread to try again or take back.
import { useSyncExternalStore } from "react";
import type { ChatMessage, ProjectChatSend } from "../../../shared/projects";
import type { RemoteClient } from "../../../shared/remote-client";

export interface Outgoing {
  chatId: string;
  send: ProjectChatSend;
  created: number;
  /** The desktop took it; it goes once the thread holds it. */
  sent?: boolean;
  error?: string;
}

type Desktop = RemoteClient["desktop"];

let items: Outgoing[] = [];
const listeners = new Set<() => void>();
function set(next: Outgoing[]) {
  items = next;
  for (const listener of listeners) listener();
}
const update = (id: string, change: Partial<Outgoing>) =>
  set(items.map((o) => (o.send.id === id ? { ...o, ...change } : o)));

function run(desktop: Desktop, item: Outgoing) {
  desktop("sendProjectChat", item.chatId, item.send).then(
    () => update(item.send.id, { sent: true, error: undefined }),
    (e) => update(item.send.id, { error: e instanceof Error ? e.message : String(e) }),
  );
}

/** Sends in the background; the desktop drops a second copy of the same id, so trying again is safe. */
export function deliver(desktop: Desktop, chatId: string, send: ProjectChatSend) {
  const item = { chatId, send, created: Date.now() };
  set([...items, item]);
  run(desktop, item);
}

export function retry(desktop: Desktop, id: string) {
  const item = items.find((o) => o.send.id === id);
  if (!item) return;
  update(id, { error: undefined });
  run(desktop, { ...item, error: undefined });
}

/** Back online: the ones the lost link stopped go out again by themselves. */
export function resendFailed(desktop: Desktop) {
  for (const o of items) if (o.error) retry(desktop, o.send.id);
}

export function drop(id: string) {
  set(items.filter((o) => o.send.id !== id));
}

/** Forgets the ones the thread now holds itself. */
export function arrived(ids: ReadonlySet<string>) {
  if (items.some((o) => ids.has(o.send.id))) set(items.filter((o) => !ids.has(o.send.id)));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => items;

export function useOutbox(chatId: string) {
  const all = useSyncExternalStore(subscribe, snapshot);
  return all.filter((o) => o.chatId === chatId);
}

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
  ...(o.error ? { error: `Not sent: ${o.error}` } : {}),
  ...(o.send.parentId ? { parentId: o.send.parentId } : {}),
  ...(o.send.side ? { side: true } : {}),
});
