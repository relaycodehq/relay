import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  replyRoots,
  threadOrder,
  type ChatSummary,
} from "../../../shared/projects";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { conversation, replyCounts, sideThreads } from "./chat-thread";

export type ChatThread = ReturnType<typeof useChatThread>;

/** A thread's messages as lib/chat-events keeps them, and the conversation
 * open in it: the main one, or the side one from `rootId`. */
export function useChatThread(
  chat: ChatSummary | undefined,
  rootId: string | null,
) {
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: chatKey(chat?.id),
    queryFn: () => fetchChat(qc, chat!.id),
    enabled: !!chat,
    // Events for a thread that isn't open are ignored, so a cached copy can
    // still say "streaming" after the answer ended; the patch is cheap.
    refetchOnMount: "always",
    // A setup's approvals come with the thread, not with its messages' events.
    refetchInterval: (query) =>
      query.state.data?.queue?.length ||
      (chat?.sentTo && query.state.data?.outbox?.length) ||
      query.state.data?.messages.some((m) => m.status === "streaming") ||
      (query.state.data?.setup?.state === "agent" &&
        query.state.data.setup.messages.some((m) => m.status === "streaming"))
        ? 1000
        : false,
  });
  const messages = useMemo(
    () => [...(history.data?.messages ?? [])].sort(threadOrder),
    [history.data?.messages],
  );
  const root = messages.find((m) => m.id === rootId);
  const roots = useMemo(() => replyRoots(messages), [messages]);
  const counts = useMemo(() => replyCounts(roots), [roots]);
  const sides = useMemo(() => sideThreads(messages, roots), [messages, roots]);
  const shown = useMemo(
    () => conversation(messages, roots, root?.id),
    [messages, roots, root?.id],
  );
  return {
    history,
    messages,
    /** The side conversation's first message, while one is open. */
    root,
    shown,
    listed: shown,
    /** Each reply's side conversation, by the message it starts from. */
    roots,
    running: messages.some((m) => m.status === "streaming"),
    /** An answer of the conversation itself is running, not only a /btw one. */
    mainRunning: messages.some(
      (m) => m.status === "streaming" && !sides.has(roots.get(m.id) ?? ""),
    ),
    replyCounts: counts,
    sideThreads: sides,
    leadAnswered: messages.some((m) => m.role === "assistant" && !m.parentId),
  };
}
