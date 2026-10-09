import { useQueries } from "@tanstack/react-query";
import type { AgentModel, AgentProvider } from "../../../shared/agents";
import { pickAgents } from "./composer-models";
import { useRunnableAgents } from "./registry-agents";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/error-message";

interface AgentPickCatalog {
  /** Undefined while loading; empty when the agent couldn't list any. */
  models: AgentModel[] | undefined;
  /** Why it couldn't, as opposed to offering none. */
  error?: string;
}
export const agentModelsQuery = (provider: AgentProvider) => ({
  queryKey: ["agent-models", provider],
  queryFn: () => api.agentModels(provider),
  staleTime: 60_000,
  retry: false,
});
/**
 * The models of each agent whose model the composer keeps in `picks`. Asked
 * once a minute at most; opening the picker asks again.
 */
export function useAgentPicks() {
  useRunnableAgents();
  const agents = pickAgents();
  const models = useQueries({ queries: agents.map(agentModelsQuery) });
  const catalogs = Object.fromEntries(
    agents.map((provider, i) => [
      provider,
      models[i].isError
        ? { models: [], error: errorMessage(models[i].error) }
        : { models: models[i].data },
    ]),
  ) as Partial<Record<AgentProvider, AgentPickCatalog>>;
  return {
    catalogs,
    refresh: () => {
      for (const query of models) void query.refetch();
    },
  };
}
