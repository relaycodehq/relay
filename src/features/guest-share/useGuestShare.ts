import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GuestShareEvent } from "../../../shared/guest-share";
import { api } from "../../lib/api";

export const guestShareKey = (threadId: string) => ["guest-share", threadId];
const suggestionsKey = (threadId: string) => ["guest-suggestions", threadId];

/** Keeps one kind of a thread's guest state current as the main process changes it. */
function useGuestShareEvents(threadId: string, kind: GuestShareEvent["kind"]) {
  const qc = useQueryClient();
  useEffect(
    () =>
      api.onGuestShare((event) => {
        if (event.threadId !== threadId || event.kind !== kind) return;
        if (event.kind === "share")
          qc.setQueryData(guestShareKey(threadId), event.share);
        else qc.setQueryData(suggestionsKey(threadId), event.suggestions);
      }),
    [qc, threadId, kind],
  );
}

/**
 * Read again whenever a thread opens: events for a thread not on screen
 * aren't heard, so what's cached for it may be behind.
 */
const ON_OPEN = { staleTime: 0 } as const;

/** The thread's live guest link, null when it has none. */
export function useGuestShare(threadId: string) {
  useGuestShareEvents(threadId, "share");
  return useQuery({
    queryKey: guestShareKey(threadId),
    queryFn: () => api.guestShare(threadId),
    ...ON_OPEN,
  });
}

/** What the thread's guests suggested that the host hasn't used or dismissed yet. */
export function useGuestSuggestions(threadId: string) {
  useGuestShareEvents(threadId, "suggestions");
  return useQuery({
    queryKey: suggestionsKey(threadId),
    queryFn: () => api.guestSuggestions(threadId),
    ...ON_OPEN,
  });
}
