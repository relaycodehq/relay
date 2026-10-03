import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentProvider } from "../../../shared/agents";
import type {
  NewThreadModel,
  NewThreadModels,
} from "../../../shared/new-thread-models";
import {
  cacheNewThreadModels,
  cachedNewThreadModels,
} from "../agents/composer-settings";
import { api } from "../../lib/api";

const key = ["new-thread-models"];

/** Each agent's model a new thread starts on, here or on the phone; checked again on focus. */
export function useNewThreadModels(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const models = await api.newThreadModels();
      cacheNewThreadModels(models);
      return models;
    },
    enabled,
    refetchOnWindowFocus: "always",
  });
  const save = useCallback(
    (provider: AgentProvider, model: NewThreadModel) => {
      const models = {
        ...(client.getQueryData<NewThreadModels>(key) ??
          cachedNewThreadModels()),
        [provider]: model,
      };
      client.setQueryData(key, models);
      cacheNewThreadModels(models);
      void api.saveNewThreadModel(provider, model).catch(() => {});
    },
    [client],
  );
  return [query.data, save] as const;
}
