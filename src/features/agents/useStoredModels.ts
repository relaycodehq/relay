import { useEffect, useState } from "react";
import { modelSchema } from "../../../shared/settings";
import { agentProviders, type AgentProvider } from "../../../shared/agents";

const favoritesKey = "relay-model-favorites";
const customsKey = (provider: AgentProvider) =>
  `relay-custom-${provider}-models`;
function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === "string" && v.length <= 200)
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
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
  const [favorites, setFavorites] = useState(() => readList(favoritesKey));
  useEffect(() => {
    localStorage.setItem(favoritesKey, JSON.stringify(favorites));
  }, [favorites]);
  return [favorites, setFavorites] as const;
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
