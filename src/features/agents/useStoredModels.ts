import { useEffect, useState, type SetStateAction } from "react";
import { modelSchema } from "../../../shared/settings";
import {
  isAgentProvider,
  runnableAgents,
  type AgentProvider,
} from "../../../shared/agents";
import { persistedStore, readText, writeJson } from "../../lib/persisted-store";
import type { Category } from "./model-picker-catalog";

const favoritesKey = "relay-model-favorites";
const customsKey = (provider: AgentProvider) =>
  `relay-custom-${provider}-models`;
function parseList(saved: string | null): string[] {
  try {
    const value: unknown = JSON.parse(saved || "[]");
    return Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === "string" && v.length <= 200)
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

const readList = (key: string) => parseList(readText(key));
const favoriteModels = persistedStore(favoritesKey, parseList, JSON.stringify);

const modelPickerCategory = persistedStore<Category | null>(
  "relay-model-picker-category",
  (saved) =>
    saved === "favorites" || saved === "message" || isAgentProvider(saved)
      ? saved
      : null,
  (category) => category,
);

function setFavoriteModels(next: SetStateAction<string[]>) {
  favoriteModels.set(
    typeof next === "function" ? next(favoriteModels.get()) : next,
  );
}

const readCustoms = (p: AgentProvider) =>
  readList(customsKey(p)).filter((id) => modelSchema.safeParse(id).success);
export type CustomModels = Partial<Record<AgentProvider, string[]>>;

/** The starred models, as `modelKey`s, kept in this browser. */
export function useFavoriteModels() {
  return [favoriteModels.use(), setFavoriteModels] as const;
}

/**
 * The last tab chosen in the full model picker, shared across threads. Only
 * favorites sticks; any other tab opens on the agent in use.
 */
export function useModelPickerCategory() {
  return [modelPickerCategory.use(), modelPickerCategory.set] as const;
}

/** Model ids typed into the picker, per agent, kept in this browser. */
export function useCustomModels() {
  const [customs, setCustoms] = useState(
    (): CustomModels =>
      Object.fromEntries(runnableAgents().map((p) => [p, readCustoms(p)])),
  );
  useEffect(() => {
    for (const [p, ids] of Object.entries(customs))
      writeJson(customsKey(p as AgentProvider), ids);
  }, [customs]);
  return [customs, setCustoms] as const;
}
