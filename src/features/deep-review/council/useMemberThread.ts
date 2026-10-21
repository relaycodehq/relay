import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chatKey, fetchChat } from "../../../lib/chat-events";
import { usePoll } from "../../../lib/poll";

/** A reviewer's thread, kept fresh like the open one while the review runs. */
export function useMemberThread(chatId: string, live: boolean) {
  const poll = usePoll();
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: chatKey(chatId),
    queryFn: () => fetchChat(qc, chatId),
    refetchInterval: (query) =>
      poll(
        live &&
          (!query.state.data?.messages.some((m) => m.role === "assistant") ||
            query.state.data.messages.some((m) => m.status === "streaming"))
          ? 1000
          : false,
      ),
  });
  return useMemo(
    () =>
      [...(history.data?.messages ?? [])].sort((a, b) => a.created - b.created),
    [history.data],
  );
}
