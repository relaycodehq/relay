import { useEffect, useState, type SetStateAction } from "react";
import { modelSchema } from "../../../shared/settings";
import { agentProviders, type AgentProvider } from "../../../shared/agents";
import { persistedStore } from "../../lib/persisted-store";

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
function readList(key: string): string[] {
  try {
    return parseList(localStorage.getItem(key));
  } catch {
    return [];
  }
}
const favoriteModels = persistedStore(favoritesKey, parseList, JSON.stringify);
function setFavoriteModels(next: SetStateAction<string[]>) {
  favoriteModels.set(
    typeof next === "function" ? next(favoriteModels.get()) : next,
  );
}
const readCustoms = () =>
  Object.fromEntries(
    agentProviders.map((p) => [
      p,
      readList(customsKey(p)).filter((id) => modelSchema.safeParse(id).success),
    ]),
  ) as Record<AgentProvider, string[]>;

/** The starred models, as `modelKey`s, kept in this browser. */
export function useFavoriteModels() {
  return [favoriteModels.use(), setFavoriteModels] as const;
}

/** Model ids typed into the picker, per agent, kept in this browser. */
export function useCustomModels() {
  const [customs, setCustoms] = useState(readCustoms);
  useEffect(() => {
    for (const p of agentProviders)
      localStorage.setItem(customsKey(p), JSON.stringify(customs[p]));
  }, [customs]);
  return [customs, setCustoms] as const;
}
