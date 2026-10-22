import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChatSummary } from "../../../shared/projects";
import { outsideBatch, subagentFanOuts } from "../../../shared/subagents";
import { api } from "../../lib/api";
import { readJson, writeJson } from "../../lib/persisted-store";
import { usePoll } from "../../lib/poll";

const CLEARED = "subagents-cleared:";

export type BackgroundWork = ReturnType<typeof useBackgroundWork>;

/** What the thread's agent has going outside its turn: subagents, and the
 * background work Claude waits on or left stopped. */
export function useBackgroundWork(
  chat: ChatSummary | undefined,
  running: boolean,
) {
  const poll = usePoll();
  // A turn doesn't end background work, so it stays listed through one; a
  // wake-up is relisted as the turn ends.
  const live = running
    ? chat?.pending?.filter((p) => p.kind === "task")
    : chat?.pending;
  const pending = live?.length ? live : undefined;
  const stopped =
    !running && !chat?.pending?.length ? chat?.stopped?.items : undefined;
  // Subagents run on after the turn that started them; ask while any might.
  const agents = useQuery({
    queryKey: ["project-chat-agents", chat?.id],
    queryFn: () => api.projectChatAgents(chat!.id),
    enabled: !!chat,
    refetchInterval: (query) =>
      poll(
        running ||
          pending ||
          query.state.data?.some((a) => a.status === "running")
          ? 1500
          : false,
      ),
  });
  // A turn can send agents off and end between two polls: look again as it
  // starts and ends, and when the thread's background work changes.
  useEffect(() => {
    if (chat) void agents.refetch();
  }, [running, chat?.pending?.length]);
  const runs = agents.data ?? [];
  // Cleared agents leave the indicator, not the thread: their rows in the
  // transcript still open them.
  const clearedKey = CLEARED + chat?.id;
  const [saved, setSaved] = useState(() => ({
    key: clearedKey,
    at: readJson(clearedKey),
  }));
  const cleared = saved.key === clearedKey ? saved.at : readJson(clearedKey);
  const { latest: agentBatch, earlier: earlierBatches } = subagentFanOuts(
    typeof cleared === "number"
      ? runs.filter((r) => r.started > cleared)
      : runs,
  );
  return {
    agents: runs,
    agentBatch,
    earlierBatches,
    /** Hides every agent so far; the next fan-out brings the indicator back. */
    clearAgents() {
      const at = Math.max(...runs.map((r) => r.started));
      writeJson(clearedKey, at);
      setSaved({ key: clearedKey, at });
    },
    pending,
    stopped,
    // The indicator shows the batch's agents, and stops them; the strip keeps the rest.
    leftBehind: pending && outsideBatch(pending, agentBatch),
  };
}
