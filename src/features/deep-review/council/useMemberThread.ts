import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyChatPatch,
  knownOf,
  type ChatMessage,
  type ProjectChat,
} from "../../../../shared/projects";
import { api } from "../../../lib/api";

/** A council member's hidden thread, kept fresh like the main one. */
export function useMemberThread(chatId: string, live: boolean) {
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ["project-chat", chatId],
    queryFn: async () => {
      const previous = qc.getQueryData<ProjectChat>(["project-chat", chatId]);
      const known = knownOf(previous);
      return applyChatPatch(await api.projectChat(chatId, known), previous);
    },
    refetchInterval: (query) =>
      live &&
      (!query.state.data?.messages.some((m) => m.role === "assistant") ||
        query.state.data.messages.some((m) => m.status === "streaming"))
        ? 1000
        : false,
  });
  const [updates, setUpdates] = useState<Record<string, ChatMessage>>({});
  // The history itself refetches through lib/chat-events.
  useEffect(
    () =>
      api.onProjectChat((e) => {
        if (e.chatId === chatId)
          setUpdates((old) => ({ ...old, [e.message.id]: e.message }));
      }),
    [chatId],
  );
  return useMemo(() => {
    const byId = new Map((history.data?.messages ?? []).map((m) => [m.id, m]));
    for (const m of Object.values(updates))
      if (!byId.has(m.id) || byId.get(m.id)!.version <= m.version)
        byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.created - b.created);
  }, [history.data, updates]);
}
