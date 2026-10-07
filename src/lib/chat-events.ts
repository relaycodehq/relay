import type { QueryClient } from "@tanstack/react-query";
import {
  applyChatPatch,
  knownOf,
  type ChatMessage,
  type ChatSummary,
  type Project,
  type ProjectChat,
} from "../../shared/projects";
import { api } from "./api";

/** Under "project-chats", so every refresh of the chat lists reaches it too. */
export const SCRATCH_CHATS = ["project-chats", "scratchpad"];

export const chatKey = (id: string | undefined) => ["project-chat", id];

/**
 * The one place the desktop's pushes reach the query cache, so a thread's
 * cached copy is all the window believes about it. Thread lists arrive whole,
 * so nothing polls for them. A pushed message goes straight into the cached
 * thread; the history refetches when a message settles, or when one it
 * doesn't hold yet starts streaming.
 */
export function followChatEvents(qc: QueryClient) {
  const lists = api.onProjectChats(({ projectId, chats }) => {
    qc.setQueryData(["project-chats", projectId], chats);
    const project = qc
      .getQueriesData<Project[]>({ queryKey: ["projects"] })
      .flatMap(([, list]) => list ?? [])
      .find((p) => p.id === projectId);
    // One the window hasn't listed yet may be a new Scratchpad chat's, or
    // a project an agent just added.
    if (!project) {
      void qc.invalidateQueries({ queryKey: SCRATCH_CHATS, exact: true });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    } else if (project.scratch)
      qc.setQueryData<ChatSummary[]>(SCRATCH_CHATS, (list) =>
        list
          ?.filter((c) => c.projectId !== projectId)
          .concat(chats)
          .sort((a, b) => b.updated - a.updated),
      );
  });
  const messages = api.onProjectChat((e) => {
    const key = chatKey(e.chatId);
    // A thread that isn't open isn't fetched; it refetches as it opens.
    const held = qc.getQueryData<ProjectChat>(key);
    const known = held?.messages.some((m) => m.id === e.message.id);
    const next = held && withMessage(held, e.message);
    if (next !== held) qc.setQueryData(key, next);
    // One that shows up through an event alone, like the answer after a
    // handoff note, would otherwise leave its approvals unfetched.
    if (e.message.status !== "streaming" || !known)
      void qc.invalidateQueries({ queryKey: key, exact: true });
  });
  return () => {
    lists();
    messages();
  };
}

/**
 * The thread as the desktop has it now, fetching in full only the messages
 * whose version moved. A message the reply leaves out is gone, like an empty
 * answer a steer replaced.
 */
export async function fetchChat(
  qc: QueryClient,
  id: string,
): Promise<ProjectChat> {
  const previous = qc.getQueryData<ProjectChat>(chatKey(id));
  const known = knownOf(previous);
  const fetched = applyChatPatch(await api.projectChat(id, known), previous);
  // A push that overtook the reply holds a newer copy than the reply does.
  const held = new Map(
    qc.getQueryData<ProjectChat>(chatKey(id))?.messages.map((m) => [m.id, m]),
  );
  return {
    ...fetched,
    messages: fetched.messages.map((m) => {
      const pushed = held.get(m.id);
      return pushed && pushed.version > m.version ? pushed : m;
    }),
  };
}

/** `chat` with `message` in it, unless it holds that version or a newer one. */
function withMessage(chat: ProjectChat, message: ChatMessage): ProjectChat {
  const index = chat.messages.findIndex((m) => m.id === message.id);
  if (index >= 0 && chat.messages[index].version >= message.version)
    return chat;
  const messages = [...chat.messages];
  if (index >= 0) messages[index] = message;
  else messages.push(message);
  return { ...chat, messages };
}
