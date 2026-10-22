// Threads handed off to another computer, as that computer has them.
import { useQuery } from "@tanstack/react-query";
import type { HandoffView } from "../../../shared/handoff";
import type { ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/poll";

/** Every away thread's view, asked every few seconds while there is one. */
export function useAwayViews(chats: ChatSummary[]) {
  const poll = usePoll();
  const query = useQuery({
    queryKey: ["handoff-views"],
    queryFn: () => api.handoffViews(),
    enabled: chats.some((c) => c.sentTo),
    refetchInterval: poll(3000),
  });
  return query.data ?? {};
}

/** The turn there stopped with an error. */
export const awayStopped = (view?: HandoffView) =>
  !!view?.online && !view.remote?.running && !!view.remote?.failed;
