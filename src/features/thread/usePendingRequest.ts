import type { RefObject } from "react";
import type { AgentResponse } from "../../../shared/agent-modes";
import type { ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import type { ComposerHandle } from "../composer/ProjectComposer";
import type { ChatThread } from "./useChatThread";

/** The oldest request the thread's agent waits on, and how to answer it. */
export function usePendingRequest(
  chat: ChatSummary | undefined,
  history: ChatThread["history"],
  composer: RefObject<ComposerHandle | null>,
) {
  const requests = history.data?.requests ?? [];
  const request = requests[0];

  async function respond(response: AgentResponse) {
    if (!chat || !request) return;
    await api.respondProjectChat(chat.id, request.id, response);
    const { data } = await history.refetch();
    // The answered request takes the clicked button, and the focus, with it.
    if (!data?.requests?.length)
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (
          !active ||
          active === document.body ||
          active.closest(".agent-request, .approval-tab")
        )
          composer.current?.focus();
      });
  }

  return { request, count: requests.length, respond };
}
