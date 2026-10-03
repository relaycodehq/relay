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
    queryFn: () => fetchChat(qc, chat!.id, { shared: !!chat!.shared }),
    enabled: !!chat,
    // Events for a thread that isn't open are ignored, so a cached copy can
    // still say "streaming" after the answer ended; the patch is cheap.
    refetchOnMount: "always",
    refetchInterval: (query) =>
      chat?.shared
        ? 2000
        : query.state.data?.queue?.length ||
            query.state.data?.messages.some((m) => m.status === "streaming")
          ? 1000
          : false,
  });
  const messages = useMemo(
    () => [...(history.data?.messages ?? [])].sort(threadOrder),
    [history.data],
  );
  const root = messages.find((m) => m.id === rootId);
  const roots = useMemo(() => replyRoots(messages), [messages]);
  const counts = useMemo(() => replyCounts(roots), [roots]);
  const sides = useMemo(() => sideThreads(messages, roots), [messages, roots]);
  const shown = useMemo(
    () => conversation(messages, roots, root?.id),
    [messages, roots, root?.id],
  );
  // A council's brief shows inside it, not as an answer of its own.
  const listed = useMemo(() => shown.filter((m) => !m.brief), [shown]);
  return {
    history,
    messages,
    /** The side conversation's first message, while one is open. */
    root,
    shown,
    listed,
    running: messages.some((m) => m.status === "streaming"),
    replyCounts: counts,
    sideThreads: sides,
    leadAnswered: messages.some((m) => m.role === "assistant" && !m.parentId),
  };
}
