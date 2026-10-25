import { api } from "../../lib/api";
import { AgentRequestCard } from "./AgentRequestCard";
import type { ChatThread } from "./useChatThread";

/**
 * The agent's oldest open request, above the composer. Answering the last one
 * hands the focus back to the draft, since the card took the clicked button
 * and the focus with it.
 */
export function OpenRequestCard({
  chatId,
  history,
  focusComposer,
}: {
  chatId: string | undefined;
  history: ChatThread["history"];
  focusComposer: () => void;
}) {
  const requests = history.data?.requests;
  const request = requests?.[0];
  if (!request) return null;
  return (
    <AgentRequestCard
      key={request.id}
      request={request}
      pendingCount={requests.length}
      onRespond={async (response) => {
        if (!chatId) return;
        await api.respondProjectChat(chatId, request.id, response);
        const { data } = await history.refetch();
        if (data?.requests?.length) return;
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (
            !active ||
            active === document.body ||
            active.closest(".agent-request")
          )
            focusComposer();
        });
      }}
    />
  );
}
