import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../../lib/error-message";
import { agentModelsQuery } from "./useAgentPicks";

/**
 * The models Claude Code lists: undefined while it's asked, empty with an
 * `error` when it couldn't answer. `refresh` asks again, e.g. once the user signed in or
 * updated Claude Code. With `computerId`, that paired computer's copy's.
 */
export function useClaudeModels(enabled = true, computerId?: string) {
  const query = useQuery({
    ...agentModelsQuery("claude", computerId),
    enabled,
    staleTime: Infinity,
  });
  return {
    models: query.isError ? [] : query.data,
    error: query.isError ? errorMessage(query.error) : undefined,
    refresh: () => void query.refetch(),
  };
}
