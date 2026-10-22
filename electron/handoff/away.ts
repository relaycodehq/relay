import { inSetup, liveAway } from "../../shared/handoff";
import type { ChatSummary } from "../../shared/projects";
import type { Store } from "../app/store";

/** The thread as the list has it now. */
export const listed = (store: Store, chatId: string) =>
  store.get().chats?.find((c) => c.id === chatId);

export function summaryOf(store: Store, chatId: string): ChatSummary {
  const chat = listed(store, chatId);
  if (!chat) throw new Error("Chat not found.");
  return chat;
}

/** Whether the thread is still on this handoff, rather than taken back. */
export const onHandoff = (store: Store, chatId: string, id: string) =>
  listed(store, chatId)?.sentTo?.id === id;

/** Threads live on the computer, rather than on their way or coming back. */
export const liveOn = (store: Store, computerId: string) =>
  (store.get().chats ?? []).filter(
    (c) => c.sentTo?.computerId === computerId && liveAway(c),
  );

/** Threads waiting on a setup on the computer, its agent at work there. */
export const setupsOn = (store: Store, computerId: string) =>
  (store.get().chats ?? []).filter(
    (c) => c.sentTo?.computerId === computerId && inSetup(c),
  );

/** A handoff as main.log names it: its id's start, never the thread's title. */
export const named = (id: string, computer: string) =>
  `${id.slice(0, 8)} with ${computer}`;

export const seconds = (since: number) =>
  `${((Date.now() - since) / 1000).toFixed(1)}s`;

/** Why a thread of a project on another computer can't run here instead. */
export const stays = (computer: string) =>
  `This thread's project is on ${computer}, so it runs there only.`;
