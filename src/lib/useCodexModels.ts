import { useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fallbackCodexModels,
  modelSchema,
  reasoningEffortSchema,
  type CodexModel,
} from "../../shared/settings";
import { api } from "./api";

const savedKey = "relay-codex-models";
function readSaved(): CodexModel[] | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savedKey) || "[]");
    const models = Array.isArray(value)
      ? value.filter(
          (m): m is CodexModel =>
            modelSchema.safeParse(m?.id).success &&
            typeof m.name === "string" &&
            typeof m.description === "string" &&
            typeof m.legacy === "boolean" &&
            Array.isArray(m.efforts) &&
            m.efforts.every(
              (e: unknown) => reasoningEffortSchema.safeParse(e).success,
            ),
        )
      : [];
    return models.length ? models : undefined;
  } catch {
    return undefined;
  }
}
const codexModelsQuery = {
  queryKey: ["codex-models"],
  queryFn: async () => {
    const models = await api.agentModels("codex");
    if (models.length) localStorage.setItem(savedKey, JSON.stringify(models));
    return models;
  },
  staleTime: Infinity,
  retry: false,
};
/**
 * The models the signed-in Codex offers. The last list shows at once while
 * Codex is asked again; the built-in list stands in until it has answered.
 */
export function useCodexModels() {
  const [saved] = useState(readSaved);
  const query = useQuery(codexModelsQuery);
  return {
    models: query.data?.length ? query.data : (saved ?? fallbackCodexModels),
    /** Asks again: after signing in, or once Codex was updated. */
    refresh: () => void query.refetch(),
  };
}
/** The same list outside React, asking Codex only when nothing has yet. */
export async function codexModels(qc: QueryClient): Promise<CodexModel[]> {
  const models = await qc.fetchQuery(codexModelsQuery).catch(() => []);
  return models.length ? models : (readSaved() ?? fallbackCodexModels);
}
