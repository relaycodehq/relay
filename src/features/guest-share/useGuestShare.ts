import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

export const guestShareKey = (threadId: string) => ["guest-share", threadId];
const suggestionsKey = (threadId: string) => ["guest-suggestions", threadId];

/** Keeps a thread's link and waiting suggestions current as the main process changes them. */
function useGuestShareEvents(threadId: string) {
  const qc = useQueryClient();
  useEffect(
    () =>
      api.onGuestShare((event) => {
        if (event.threadId !== threadId) return;
        if (event.kind === "share")
          qc.setQueryData(guestShareKey(threadId), event.share);
        else qc.setQueryData(suggestionsKey(threadId), event.suggestions);
      }),
    [qc, threadId],
  );
}

/** The thread's live guest link, null when it has none. */
export function useGuestShare(threadId: string) {
  useGuestShareEvents(threadId);
  return useQuery({
    queryKey: guestShareKey(threadId),
    queryFn: () => api.guestShare(threadId),
  });
}

/** What the thread's guests suggested that the host hasn't used or dismissed yet. */
export function useGuestSuggestions(threadId: string) {
  useGuestShareEvents(threadId);
  return useQuery({
    queryKey: suggestionsKey(threadId),
    queryFn: () => api.guestSuggestions(threadId),
  });
}
