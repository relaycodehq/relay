import { useQueries } from "@tanstack/react-query";
import type {
  AgentDefaults,
  AgentModel,
  AgentProvider,
} from "../../shared/agents";
import { pickAgents } from "./composer-settings";
import { api } from "./api";

export interface AgentPickCatalog {
  /** Undefined while loading; empty when the agent couldn't list any. */
  models: AgentModel[] | undefined;
  defaults: AgentDefaults | null | undefined;
}
/**
 * The models and Default of each agent whose model the composer keeps in
 * `picks`. Asked once a minute at most; opening the picker asks again.
 */
export function useAgentPicks(projectId: string) {
  const models = useQueries({
    queries: pickAgents.map((provider) => ({
      queryKey: ["agent-models", provider],
      queryFn: () => api.agentModels(provider),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const defaults = useQueries({
    queries: pickAgents.map((provider) => ({
      queryKey: ["agent-defaults", projectId, provider],
      queryFn: () => api.agentDefaults(projectId, provider),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });
  const catalogs = Object.fromEntries(
    pickAgents.map((provider, i) => [
      provider,
      {
        models: models[i].isError ? [] : models[i].data,
        defaults: defaults[i].data,
      },
    ]),
  ) as Partial<Record<AgentProvider, AgentPickCatalog>>;
  return {
    catalogs,
    refresh: () => {
      for (const query of [...models, ...defaults]) void query.refetch();
    },
  };
}
