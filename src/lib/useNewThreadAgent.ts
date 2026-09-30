import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentProvider } from "../../shared/agents";
import { api } from "./api";

const key = ["new-thread-agent"];
export const newThreadAgentQuery = {
  queryKey: key,
  queryFn: () => api.newThreadAgent(),
};

/** The agent last picked for a new thread, here or on the phone; checked again on focus. */
export function useNewThreadAgent(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    ...newThreadAgentQuery,
    enabled,
    refetchOnWindowFocus: "always",
  });
  const save = useCallback(
    (provider: AgentProvider) => {
      client.setQueryData(key, provider);
      void api.saveNewThreadAgent(provider).catch(() => {});
    },
    [client],
  );
  return [query.data, save] as const;
}
