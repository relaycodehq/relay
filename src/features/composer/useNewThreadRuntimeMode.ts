import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuntimeMode } from "../../../shared/agent-modes";
import { cacheNewThreadRuntimeMode } from "../agents/composer-settings";
import { api } from "../../lib/api";

const key = ["new-thread-runtime-mode"];

/** The access a new thread starts on, here or on the phone; checked again on focus. */
export function useNewThreadRuntimeMode(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const mode = await api.newThreadRuntimeMode();
      if (mode) cacheNewThreadRuntimeMode(mode);
      return mode;
    },
    enabled,
    refetchOnWindowFocus: "always",
  });
  const save = useCallback(
    (mode: RuntimeMode) => {
      client.setQueryData(key, mode);
      cacheNewThreadRuntimeMode(mode);
      void api.saveNewThreadRuntimeMode(mode).catch((e) => {
        console.warn("Could not save the new thread's access:", e);
        void client.invalidateQueries({ queryKey: key });
      });
    },
    [client],
  );
  return [query.data, save] as const;
}
