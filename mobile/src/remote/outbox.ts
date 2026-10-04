// Messages on their way to the desktop. A send can take a while (a worktree
// to make, images to carry over a slow link), so the thread shows the message
// at once and the composer is free again; a send that fails stays in the
// thread to try again or take back. Until the desktop has one it is also kept
// on disk, so a send cut short by Android closing the app goes out on the
// next launch instead of vanishing with the composer already cleared.
import { useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";
import {
  projectChatSendSchema,
  type ChatMessage,
  type ProjectChatSend,
} from "../../../shared/projects";
import type { RemoteClient } from "../../../shared/remote-client";

export interface Outgoing {
  /** The paired computer it's for; it only ever goes to that one. */
  computer: string;
  chatId: string;
  send: ProjectChatSend;
  created: number;
  /** The desktop took it; it goes once the thread holds it. */
  sent?: boolean;
  error?: string;
}

type Desktop = RemoteClient["desktop"];

const shelf = () => new Directory(Paths.document, "relay-outbox");
const shelved = (id: string) => new File(shelf(), `${id}.json`);

function keep({ computer, chatId, send, created }: Outgoing) {
  try {
    const file = shelved(send.id);
    file.parentDirectory.create({ idempotent: true, intermediates: true });
    file.write(JSON.stringify({ computer, chatId, send, created }));
  } catch {
    // A full disk costs the copy; the send itself still goes.
  }
}

function unkeep(id: string) {
  try {
    const file = shelved(id);
    if (file.exists) file.delete();
  } catch {
    // Left behind, it is sent again next launch and the desktop drops the copy.
  }
}

/** The ones the last run never got to the desktop, failed until they go again. */
function kept(): Outgoing[] {
  try {
    if (!shelf().exists) return [];
    return shelf()
      .list()
      .flatMap((entry) => {
        if (!(entry instanceof File)) return [];
        try {
          const o = JSON.parse(entry.textSync());
          const send = projectChatSendSchema.safeParse(o.send);
          if (!send.success || typeof o.computer !== "string" || typeof o.chatId !== "string")
            return [];
          return [
            {
              computer: o.computer,
              chatId: o.chatId,
              send: send.data,
              created: Number(o.created) || Date.now(),
              error: "Relay closed before it went out",
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.created - b.created);
  } catch {
    return [];
  }
}

let items: Outgoing[] = kept();
const listeners = new Set<() => void>();
function set(next: Outgoing[]) {
  items = next;
  for (const listener of listeners) listener();
}
const update = (id: string, change: Partial<Outgoing>) =>
  set(items.map((o) => (o.send.id === id ? { ...o, ...change } : o)));

function run(desktop: Desktop, item: Outgoing) {
  desktop("sendProjectChat", item.chatId, item.send).then(
    () => {
      unkeep(item.send.id);
      update(item.send.id, { sent: true, error: undefined });
    },
    (e) => update(item.send.id, { error: e instanceof Error ? e.message : String(e) }),
  );
}

/** Sends in the background; the desktop drops a second copy of the same id, so trying again is safe. */
export function deliver(
  desktop: Desktop,
  computer: string,
  chatId: string,
  send: ProjectChatSend,
) {
  const item = { computer, chatId, send, created: Date.now() };
  keep(item);
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
export function resendFailed(desktop: Desktop, computer: string) {
  for (const o of items)
    if (o.error && o.computer === computer) retry(desktop, o.send.id);
}

export function drop(id: string) {
  unkeep(id);
  set(items.filter((o) => o.send.id !== id));
}

/** Forgets the ones the thread now holds itself. */
export function arrived(ids: ReadonlySet<string>) {
  if (!items.some((o) => ids.has(o.send.id))) return;
  for (const o of items) if (ids.has(o.send.id)) unkeep(o.send.id);
  set(items.filter((o) => !ids.has(o.send.id)));
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
