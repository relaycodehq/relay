import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChatSummary } from "../../../shared/projects";
import { outsideBatch, runningBatch } from "../../../shared/subagents";
import { api } from "../../lib/api";

export type BackgroundWork = ReturnType<typeof useBackgroundWork>;

/** What the thread's agent has going outside its turn: subagents, and the
 * background work Claude waits on or left stopped. */
export function useBackgroundWork(
  chat: ChatSummary | undefined,
  running: boolean,
) {
  // Once Claude picks its work back up, its turn shows that instead.
  const pending = !running && chat?.pending?.length ? chat.pending : undefined;
  const stopped = !running && !pending ? chat?.stopped?.items : undefined;
  // Subagents run on after the turn that started them; ask while any might.
  const agents = useQuery({
    queryKey: ["project-chat-agents", chat?.id],
    queryFn: () => api.projectChatAgents(chat!.id),
    enabled: !!chat,
    refetchInterval: (query) =>
      running ||
      pending ||
      query.state.data?.some((a) => a.status === "running")
        ? 1500
        : false,
  });
  // A turn can send agents off and end between two polls: look again as it
  // starts and ends, and when the thread's background work changes.
  useEffect(() => {
    if (chat) void agents.refetch();
  }, [running, chat?.pending?.length]);
  const runs = agents.data ?? [];
  const agentBatch = runningBatch(runs);
  return {
    agents: runs,
    agentBatch,
    pending,
    stopped,
    // The indicator shows the batch's agents, and stops them; the strip keeps the rest.
    leftBehind: pending && outsideBatch(pending, agentBatch),
  };
}
