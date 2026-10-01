import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyChatPatch,
  knownOf,
  type ChatMessage,
  type ChatSummary,
  type ProjectChat as ProjectChatData,
} from "../../shared/projects";
import { api } from "./api";
import {
  conversation,
  replyCounts,
  replyRoots,
  sideThreads,
  withUpdates,
} from "./chat-thread";

export type ChatThread = ReturnType<typeof useChatThread>;

/** A thread's messages as fetched and streamed, and the conversation open in
 * it: the main one, or the side one from `rootId`. */
export function useChatThread(
  chat: ChatSummary | undefined,
  rootId: string | null,
) {
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ["project-chat", chat?.id],
    queryFn: async () => {
      // Long threads would otherwise cross IPC whole on every poll; only
      // messages whose version moved come back in full.
      const previous = qc.getQueryData<ProjectChatData>([
        "project-chat",
        chat!.id,
      ]);
      const known = knownOf(previous);
      const patch = await (chat!.shared
        ? api.syncProjectChat(chat!.id, known)
        : api.projectChat(chat!.id, known));
      return applyChatPatch(patch, previous);
    },
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
  const [updates, setUpdates] = useState<Record<string, ChatMessage>>({});
  // The history itself refetches through lib/chat-events.
  useEffect(
    () =>
      api.onProjectChat((e) => {
        if (e.chatId === chat?.id)
          setUpdates((old) => ({ ...old, [e.message.id]: e.message }));
      }),
    [chat?.id],
  );
  const messages = useMemo(
    () => withUpdates(history.data?.messages ?? [], updates),
    [history.data, updates],
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
