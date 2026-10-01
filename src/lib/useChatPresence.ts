import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChatSummary } from "../../shared/projects";
import { api } from "./api";
import { useStoredFlag } from "./useStoredFlag";
import type { Viewing } from "./useThreadView";

export type ChatPresence = ReturnType<typeof useChatPresence>;

/** Who else has a shared thread open, and where; they see where you are
 * only while `sharePresence` is on. */
export function useChatPresence(
  chat: ChatSummary | undefined,
  viewing: Viewing,
) {
  const [sharePresence, setSharePresence] = useStoredFlag(
    "relay-project-presence",
  );
  const presence = useQuery({
    queryKey: ["chat-presence", chat?.id, sharePresence, viewing],
    queryFn: () =>
      api.projectChatPresence(chat!.id, sharePresence ? viewing : null),
    enabled: !!chat?.shared,
    refetchInterval: 5000,
    retry: false,
  });
  useEffect(
    () => () => {
      if (chat?.shared)
        void api.projectChatPresence(chat.id, null).catch(() => {});
    },
    [chat?.id, chat?.shared?.roomId],
  );
  const peers =
    presence.data?.filter((p) => p.userId !== chat?.shared?.memberId) ?? [];
  return { peers, sharePresence, setSharePresence };
}
