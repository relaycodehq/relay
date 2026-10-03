import { useCallback, useRef } from "react";
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
  /** The latest save; an older one failing leaves a newer one be. */
  const latest = useRef(0);
  const save = useCallback(
    (provider: AgentProvider, model: NewThreadModel) => {
      const request = ++latest.current;
      const models = {
        ...(client.getQueryData<NewThreadModels>(key) ??
          cachedNewThreadModels()),
        [provider]: model,
      };
      client.setQueryData(key, models);
      cacheNewThreadModels(models);
      // Shown as saved at once; one that wasn't goes back to what's kept now,
      // not at some later focus.
      void api.saveNewThreadModel(provider, model).catch((e) => {
        console.warn("Could not save the new thread model:", e);
        if (latest.current === request)
          void client.invalidateQueries({ queryKey: key });
      });
    },
    [client],
  );
  return [query.data, save] as const;
}
