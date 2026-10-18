import { useEffect, useReducer } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { defaultAutoCompact } from "../../../shared/context-usage";
import type { PromptCache } from "../../../shared/projects";

export const autoCompactQuery = {
  queryKey: ["auto-compact"],
  // Read at call time: the context meter's helpers are imported outside a window.
  queryFn: () => window.relay.autoCompact(),
};

/** When Relay compacts big conversations unasked; the defaults until known. */
export const useAutoCompact = () =>
  useAutoCompactSaved() ?? defaultAutoCompact;

/**
 * As saved, undefined until known; kept current when another window saves
 * it, since a window doesn't refetch when it's focused.
 */
export function useAutoCompactSaved() {
  const qc = useQueryClient();
  useEffect(
    () =>
      window.relay.onAutoCompact((value) => {
        // A change still saving here is newer than an earlier one told back.
        if (!qc.isMutating({ mutationKey: autoCompactQuery.queryKey }))
          qc.setQueryData(autoCompactQuery.queryKey, value);
      }),
    [qc],
  );
  return useQuery(autoCompactQuery).data;
}

/** Whether the prompt cache has expired, looked at again the moment it does. */
export function useCacheExpired(cache: PromptCache | undefined) {
  const [, wake] = useReducer((n: number) => n + 1, 0);
  const expires = cache ? cache.at + cache.ttlMs : undefined;
  const expired = expires !== undefined && Date.now() >= expires;
  useEffect(() => {
    if (expires === undefined || expired) return;
    const timer = setTimeout(wake, expires - Date.now() + 50);
    // Timers stall while the machine sleeps; look again when the window returns.
    window.addEventListener("focus", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
    };
  }, [expires, expired]);
  return expired;
}
