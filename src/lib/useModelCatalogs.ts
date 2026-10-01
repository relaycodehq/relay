import { useMemo } from "react";
import {
  agentProviders,
  type AgentModel,
  type AgentProvider,
} from "../../shared/agents";
import { useAgentDefaults } from "./useAgentDefaults";
import { useAgentPicks } from "./useAgentPicks";
import { useClaudeModels } from "./useClaudeModels";
import { useCodexModels } from "./useCodexModels";
import { useStableCallback } from "./useStableCallback";

export type ModelCatalogs = ReturnType<typeof useModelCatalogs>;

/** The models each agent lists, and what its Default runs in this project. */
export function useModelCatalogs(projectId: string) {
  const agentPicks = useAgentPicks();
  const claudeCatalog = useClaudeModels();
  const claude = claudeCatalog.models;
  const codexCatalog = useCodexModels();
  const codex = codexCatalog.models;
  const defaults = useAgentDefaults(projectId);
  const of = (p: AgentProvider): AgentModel[] | undefined =>
    p === "codex"
      ? codex
      : p === "claude"
        ? claude
        : agentPicks.catalogs[p]?.models;
  // The model each agent's Default runs, by its listed name.
  const defaultModels = agentProviders.map((p) => defaults.of(p)?.model ?? "");
  const defaultNames = useMemo(
    (): Partial<Record<AgentProvider, string>> =>
      Object.fromEntries(
        agentProviders.flatMap((p, i) => {
          const runs = defaultModels[i];
          return runs
            ? [[p, of(p)?.find((m) => m.id === runs)?.name ?? runs]]
            : [];
        }),
      ),
    [defaultModels.join("\0"), codex, claude, agentPicks.catalogs],
  );
  const refresh = useStableCallback(() => {
    // Signing in or updating a CLI changes its list; ask again.
    claudeCatalog.refresh();
    codexCatalog.refresh();
    defaults.refresh();
    agentPicks.refresh();
  });
  return {
    claude,
    codex,
    /** The agents whose model the composer keeps in `picks`; see lib/composer-settings. */
    picks: agentPicks.catalogs,
    defaults,
    of,
    defaultNames,
    refresh,
  };
}
