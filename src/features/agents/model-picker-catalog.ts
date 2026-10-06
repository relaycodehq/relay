import { modelSchema } from "../../../shared/settings";
import {
  agentName,
  agentProviders,
  agents,
  type AgentModel,
  type AgentProvider,
} from "../../../shared/agents";
import { fuzzyBase, rankModelQuery } from "./model-search";

export type MessageProvider = AgentProvider | "message";
export type Category = MessageProvider | "favorites";
export type PickerModel = {
  provider: MessageProvider;
  id: string;
  name: string;
  legacy?: boolean;
  custom?: boolean;
  description?: string;
  /** Its section, e.g. the upstream provider an OpenCode model runs on. */
  group?: string;
};
/** What the picker offers for one agent. */
export interface AgentCatalog {
  /** Listed by the agent; undefined while loading. */
  models: AgentModel[] | undefined;
  /** The model picked for it; "" is its Default. */
  model: string;
  /** Why the agent couldn't list its models, as opposed to offering none. */
  error?: string;
}
export const providerNames: Record<MessageProvider, string> = {
  ...(Object.fromEntries(
    agentProviders.map((p) => [p, agentName(p)]),
  ) as Record<AgentProvider, string>),
  message: "No agent",
};
const searchWords = (query: string) =>
  Math.max(1, query.trim().split(/\s+/).filter(Boolean).length);
export const modelKey = (m: PickerModel) => JSON.stringify([m.provider, m.id]);

// An agent with hundreds of models from many providers lists them by provider.
export const isGrouped = (category: Category) =>
  category !== "favorites" &&
  category !== "message" &&
  agents[category].modelGroups;

/**
 * Every row the picker could show. Each agent's listed models sit above its
 * Default, then ids it doesn't list: typed-in custom ones, and the pick itself.
 */
export function pickerCatalog(
  offered: readonly AgentProvider[],
  catalogs: Partial<Record<AgentProvider, AgentCatalog>>,
  customs: Record<AgentProvider, string[]>,
): PickerModel[] {
  return [
    ...offered.flatMap((p): PickerModel[] => {
      const listed = catalogs[p]!.models ?? [];
      const unlisted = [...customs[p], catalogs[p]!.model].filter(
        (id, i, all) =>
          id && all.indexOf(id) === i && !listed.some((m) => m.id === id),
      );
      return [
        ...listed.map((m) => ({
          provider: p,
          id: m.id,
          name: m.name,
          description: m.description,
          legacy: m.legacy,
          group: m.group,
        })),
        { provider: p, id: "", name: `${agentName(p)} default` },
        ...unlisted.map((id) => ({
          provider: p,
          id,
          name: id,
          custom: customs[p].includes(id),
        })),
      ];
    }),
    { provider: "message", id: "", name: "Message only" },
  ];
}

/**
 * The rows one tab of the picker lists for a search, best first; the
 * sections of a grouped agent with how many rows match in each; and where
 * the legacy models start.
 */
export function pickerRows(
  catalog: PickerModel[],
  {
    category,
    query,
    legacy,
    group,
    favorites,
    pinned,
    allowDefault,
  }: {
    category: Category;
    query: string;
    /** The legacy models are unfolded. */
    legacy: boolean;
    /** The section picked in a grouped agent; "" is all of them. */
    group: string;
    favorites: string[];
    /** Favorites as they were when the picker opened, which lead the list. */
    pinned: string[];
    allowDefault: boolean;
  },
) {
  const grouped = isGrouped(category);
  const legacyCount = catalog.filter(
    (m) => m.provider === category && m.legacy,
  ).length;
  const matching = catalog
    .filter((m) => allowDefault || m.provider === "message" || m.id)
    .filter((m) => {
      if (category === "favorites") return favorites.includes(modelKey(m));
      return (
        m.provider === category &&
        (!m.legacy || legacy || query.trim() || pinned.includes(modelKey(m)))
      );
    })
    .map((m, index) => ({
      model: m,
      index,
      pinned: pinned.includes(modelKey(m)),
      score: rankModelQuery(
        {
          driverKind: m.provider,
          providerDisplayName: providerNames[m.provider],
          name: m.name,
          shortName: m.id,
          subProvider: [m.group, m.description].filter(Boolean).join(" "),
          isFavorite: pinned.includes(modelKey(m)),
        },
        query,
      ),
    }))
    // Among hundreds of models a fuzzy match is noise, and would skew the counts.
    .filter(
      (r) =>
        r.score !== null &&
        (!grouped || r.score < fuzzyBase * searchWords(query)),
    );
  const groups = grouped
    ? [
        ...new Set(
          catalog.flatMap((m) =>
            m.provider === category && m.group ? [m.group] : [],
          ),
        ),
      ].map((name) => ({
        name,
        count: matching.filter((r) => r.model.group === name).length,
      }))
    : [];
  const rows = matching
    .filter((r) => !grouped || !group || r.model.group === group)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (query.trim()
          ? a.score! - b.score!
          : Number(!!a.model.legacy) - Number(!!b.model.legacy)) ||
        a.index - b.index,
    )
    .map((r) => r.model);
  const firstLegacy = query.trim()
    ? -1
    : rows.findIndex((m) => m.legacy && !pinned.includes(modelKey(m)));
  const customId = query.trim();
  if (
    category !== "favorites" &&
    category !== "message" &&
    rows.length === 0 &&
    modelSchema.safeParse(customId).success
  )
    rows.push({
      provider: category,
      id: customId,
      name: customId,
      custom: true,
    });
  return { rows, groups, legacyCount, firstLegacy };
}
