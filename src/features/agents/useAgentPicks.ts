import { useQueries } from "@tanstack/react-query";
import type { AgentModel, AgentProvider } from "../../../shared/agents";
import { pickAgents } from "./composer-models";
import { useRunnableAgents } from "./registry-agents";
import { api } from "../../lib/api";
import { errorMessage } from "../../../shared/error-message";

interface AgentPickCatalog {
  /** Undefined while loading; empty when the agent couldn't list any. */
  models: AgentModel[] | undefined;
  /** Why it couldn't, as opposed to offering none. */
  error?: string;
}

/** An agent's models; with `computerId`, as that paired computer's copy lists them. */
export const agentModelsQuery = <P extends AgentProvider>(
  provider: P,
  computerId?: string,
) => ({
  queryKey: computerId
    ? ["agent-models", provider, computerId]
    : ["agent-models", provider],
  queryFn: () => api.agentModels(provider, computerId),
  staleTime: 60_000,
  retry: false,
});

/**
 * The models of each agent whose model the composer keeps in `picks`. Asked
 * once a minute at most; opening the picker asks again. A project on a paired
 * computer (`computerId`) offers that computer's.
 */
export function useAgentPicks(computerId?: string) {
  useRunnableAgents();
  const agents = pickAgents();
  const models = useQueries({
    queries: agents.map((p) => agentModelsQuery(p, computerId)),
  });
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
