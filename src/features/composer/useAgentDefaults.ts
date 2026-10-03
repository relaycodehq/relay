import { useQueries } from "@tanstack/react-query";
import {
  agentProviders,
  type AgentDefaults,
  type AgentProvider,
} from "../../../shared/agents";
import type { ReasoningEffort } from "../../../shared/settings";
import { api } from "../../lib/api";

/** What each agent runs in this project where a thread leaves the model or effort on Default. */
export function useAgentDefaults(projectId: string) {
  // Each read starts an agent CLI, and settings files rarely change.
  const queries = useQueries({
    queries: agentProviders.map((provider) => ({
      queryKey: ["agent-defaults", projectId, provider],
      queryFn: () => api.agentDefaults(projectId, provider),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });
  const of = (provider: AgentProvider): AgentDefaults | undefined =>
    queries[agentProviders.indexOf(provider)]?.data ?? undefined;
  return {
    of,
    /** The effort Default runs with `model` picked ("" for Default's); "" when unknown. */
    effort: (provider: AgentProvider, model: string): ReasoningEffort => {
      const defaults = of(provider);
      if (!defaults) return "";
      return model ? (defaults.efforts?.[model] ?? "") : defaults.effort;
    },
    /** Asks again, e.g. as the model picker opens after a settings edit. */
    refresh: () => {
      for (const query of queries) void query.refetch();
    },
  };
}
