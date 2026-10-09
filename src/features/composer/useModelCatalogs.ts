import { useMemo } from "react";
import type { AgentModel, AgentProvider } from "../../../shared/agents";
import { modelName } from "../../../shared/model-fit";
import { useRunnableAgents } from "../agents/registry-agents";
import { useAgentDefaults } from "./useAgentDefaults";
import { useAgentPicks } from "../agents/useAgentPicks";
import { useClaudeModels } from "../agents/useClaudeModels";
import { useCodexModels } from "../agents/useCodexModels";
import { useStableCallback } from "../../lib/useStableCallback";

export type ModelCatalogs = ReturnType<typeof useModelCatalogs>;

/** The models each agent lists, and what its Default runs in this project. */
export function useModelCatalogs(projectId: string) {
  const agentPicks = useAgentPicks();
  const claudeCatalog = useClaudeModels();
  const claude = claudeCatalog.models;
  const codexCatalog = useCodexModels();
  const codex = codexCatalog.models;
  const defaults = useAgentDefaults(projectId);
  const agents = useRunnableAgents();
  const of = (p: AgentProvider): AgentModel[] | undefined =>
    p === "codex"
      ? codex
      : p === "claude"
        ? claude
        : agentPicks.catalogs[p]?.models;
  // The model each agent's Default runs, by its listed name.
  const defaultModels = agents.map((p) => defaults.of(p)?.model ?? "");
  const defaultNames = useMemo(
    (): Partial<Record<AgentProvider, string>> =>
      Object.fromEntries(
        agents.flatMap((p, i) => {
          const runs = defaultModels[i];
          return runs ? [[p, modelName(p, of(p), runs)]] : [];
        }),
      ),
    [agents, defaultModels.join("\0"), codex, claude, agentPicks.catalogs],
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
    /** Why `provider` couldn't list its models; Codex falls back to a list of its own. */
    errorOf: (p: AgentProvider) =>
      p === "claude"
        ? claudeCatalog.error
        : p === "codex"
          ? undefined
          : agentPicks.catalogs[p]?.error,
    /** The catalogs of the agents in `pickAgents()`; see features/agents/composer-models. */
    picks: agentPicks.catalogs,
    defaults,
    of,
    defaultNames,
    refresh,
  };
}
