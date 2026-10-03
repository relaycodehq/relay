// Threads handed off to another computer, as that computer has them.
import { useQuery } from "@tanstack/react-query";
import type { HandoffView } from "../../../shared/handoff";
import type { ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";

/** Every away thread's view, asked every few seconds while there is one. */
export function useAwayViews(chats: ChatSummary[]) {
  const query = useQuery({
    queryKey: ["handoff-views"],
    queryFn: () => api.handoffViews(),
    enabled: chats.some((c) => c.sentTo),
    refetchInterval: 3000,
  });
  return query.data ?? {};
}

/**
 * The card as if the other computer's turn ran here: working, waiting on
 * you, and moving up and lighting up as it writes.
 */
export function withAway(chat: ChatSummary, view?: HandoffView): ChatSummary {
  const remote =
    view?.online && view.sentTo.state === "away" ? view.remote : undefined;
  if (!remote) return chat;
  return {
    ...chat,
    updated: Math.max(chat.updated, remote.updated),
    ...(remote.running
      ? {
          running: true,
          waiting: remote.waiting,
          ...(remote.runningSince ? { runningSince: remote.runningSince } : {}),
          ...(remote.provider ? { runningAgents: [remote.provider] } : {}),
        }
      : {}),
  };
}

/** The turn there stopped with an error. */
export const awayStopped = (view?: HandoffView) =>
  !!view?.online && !view.remote?.running && !!view.remote?.failed;
