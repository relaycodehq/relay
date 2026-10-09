// Messages on their way to the desktop. A send can take a while (a worktree
// to make, images to carry over a slow link), so the thread shows the message
// at once and the composer is free again; a send that fails stays in the
// thread to try again or take back. Until the desktop has one it is also kept
// on disk, so a send cut short by Android closing the app goes out on the
// next launch instead of vanishing with the composer already cleared.
import { useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";
import { projectChatSendSchema, type ProjectChatSend } from "../../../shared/projects";
import { remoteHistory } from "../../../shared/remote";
import { Unanswered, type RemoteClient } from "../../../shared/remote-client";
import { settled, stamp, type Outgoing } from "./outbox-state";

export { heldIds, outgoingMessage, type Outgoing } from "./outbox-state";

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
              unsure: true,
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
      update(item.send.id, { sent: stamp(), error: undefined, unsure: undefined });
    },
    (e) =>
      update(item.send.id, {
        error: e instanceof Error ? e.message : String(e),
        // A refused retry doesn't prove that an earlier unanswered copy failed.
        unsure: item.unsure || e instanceof Unanswered,
      }),
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

/** Still waiting here, unsent or failed: read at once, before any screen renders it. */
export const isOut = (id: string) => items.some((o) => o.send.id === id);

export function drop(id: string) {
  unkeep(id);
  set(items.filter((o) => o.send.id !== id));
}

/**
 * Forgets the ones thread `chatId` now holds itself, or no longer does,
 * reading as `held` from a fetch made at `fetched`.
 */
export function arrived(computer: string, chatId: string, held: ReadonlySet<string>, fetched: number) {
  const done = new Set(settled(items, computer, chatId, held, fetched));
  if (!done.size) return;
  for (const o of done) unkeep(o.send.id);
  set(items.filter((o) => !done.has(o)));
}

/**
 * Whether the desktop has one it never answered for, as a message or waiting
 * its turn: taken back to edit and sent again, it would go twice.
 */
export async function reached(
  call: RemoteClient["call"],
  o: Outgoing,
  known?: Record<string, number>,
) {
  const thread = await call("chat", o.chatId, known, remoteHistory, o.send.id);
  if (thread.hasSend === undefined)
    throw new Error("Update Relay on the computer before taking back an unanswered send.");
  // A receipt covers the full history, including an accepted send outside this page.
  if (thread.hasSend && !thread.sendPending) drop(o.send.id);
  return thread.hasSend;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => items;

export function useOutbox(computer: string, chatId: string) {
  const all = useSyncExternalStore(subscribe, snapshot);
  return all.filter((o) => o.computer === computer && o.chatId === chatId);
}

/** A pasted image of one still on its way, which the desktop can't hand back yet. */
export const outgoingImage = (id: string, index: number) =>
  items.find((o) => o.send.id === id)?.send.images?.[index]?.dataUrl;
