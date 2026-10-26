import { useMutation, useMutationState } from "@tanstack/react-query";
import type { AgentProvider } from "../../../shared/agents";
import type { ChatMessage } from "../../../shared/projects";
import type { SecondOpinionAgent } from "../../../shared/second-opinion";
import { api } from "../../lib/api";

/** An answer another agent can give a second opinion on, and its thread. */
export interface SecondOpinionTarget {
  chatId: string;
  answerId: string;
  /** The agent that wrote the answer. */
  provider: AgentProvider;
}

/** What answer `m` offers a second opinion on; nothing in a side conversation, or before it has finished. */
export function secondOpinionTarget(
  chatId: string,
  m: ChatMessage,
): SecondOpinionTarget | undefined {
  // A side conversation's answers never reach the main session.
  const inMainConversation = !m.parentId;
  const finished = m.status === "complete" && !!m.body.trim();
  if (!chatId || !inMainConversation || !finished) return undefined;
  return { chatId, answerId: m.id, provider: m.provider };
}

const askKey = (chatId: string, answerId: string) => [
  "second-opinion",
  chatId,
  answerId,
];

/** Asks for a second opinion on the answer; its card follows how that goes. */
export const useAskSecondOpinion = ({
  chatId,
  answerId,
}: SecondOpinionTarget) =>
  useMutation({
    mutationKey: askKey(chatId, answerId),
    mutationFn: (agent: SecondOpinionAgent) =>
      api.askSecondOpinion(chatId, answerId, agent),
  });

/** The latest ask for a second opinion on the answer while it starts, or why it couldn't. */
export function useLatestAsk(chatId: string, answerId: string) {
  const asks = useMutationState({
    filters: { mutationKey: askKey(chatId, answerId) },
    select: (mutation) => ({
      status: mutation.state.status,
      agent: mutation.state.variables as SecondOpinionAgent | undefined,
      error: mutation.state.error,
    }),
  });
  const latest = asks.at(-1);
  return latest?.status === "pending" || latest?.status === "error"
    ? latest
    : undefined;
}
