import { useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  fallbackCodexModels,
  modelSchema,
  reasoningEffortSchema,
  type CodexModel,
} from "../../../shared/settings";
import { api } from "../../lib/api";
import { readJson, writeJson } from "../../lib/persisted-store";

const savedKey = "relay-codex-models";
function readSaved(): CodexModel[] | undefined {
  const value = readJson(savedKey);
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
}
const codexModelsQuery = {
  queryKey: ["codex-models"],
  queryFn: async () => {
    const models = await api.agentModels("codex");
    if (models.length) writeJson(savedKey, models);
    return models;
  },
  staleTime: Infinity,
  retry: false,
};
/** A paired computer's Codex, for a project there; its list isn't kept here. */
const remoteCodexModelsQuery = (computerId: string) => ({
  queryKey: ["codex-models", computerId],
  queryFn: () => api.agentModels("codex", computerId),
  staleTime: 5 * 60_000,
  retry: false,
});
/**
 * The models the signed-in Codex offers. The last list shows at once while
 * Codex is asked again; the built-in list stands in until it has answered.
 * With `computerId`, the Codex on that paired computer.
 */
export function useCodexModels(computerId?: string) {
  const [saved] = useState(readSaved);
  const query = useQuery(
    computerId ? remoteCodexModelsQuery(computerId) : codexModelsQuery,
  );
  const fallback = computerId
    ? fallbackCodexModels
    : (saved ?? fallbackCodexModels);
  return {
    models: query.data?.length ? query.data : fallback,
    /** Asks again: after signing in, or once Codex was updated. */
    refresh: () => void query.refetch(),
  };
}
/** The same list outside React, asking Codex only when nothing has yet. */
export async function codexModels(
  qc: QueryClient,
  computerId?: string,
): Promise<CodexModel[]> {
  if (computerId) {
    const models = await qc
      .query(remoteCodexModelsQuery(computerId))
      .catch(() => []);
    return models.length ? models : fallbackCodexModels;
  }
  const models = await qc.query(codexModelsQuery).catch(() => []);
  return models.length ? models : (readSaved() ?? fallbackCodexModels);
}
