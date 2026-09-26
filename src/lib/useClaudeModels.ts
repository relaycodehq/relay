import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * The models Claude Code lists: undefined while it's asked, empty when it
 * couldn't answer. `retry` asks again, e.g. once the user signed in.
 */
export function useClaudeModels(enabled = true) {
  const query = useQuery({
    queryKey: ["agent-models", "claude"],
    queryFn: () => api.agentModels("claude"),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  return {
    models: query.isError ? [] : query.data,
    retry: () => {
      if (query.isError || !query.data?.length) void query.refetch();
    },
  };
}
