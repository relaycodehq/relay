import type { AgentProvider } from "../../../shared/agents";
import {
  claudeEffortsFor,
  reasoningEffortsFor,
  type ReasoningEffort,
} from "../../../shared/settings";
import { useAgentPicks } from "./useAgentPicks";
import { useClaudeModels } from "./useClaudeModels";
import { useCodexModels } from "./useCodexModels";

/** Every agent's listed models, and the efforts a model takes. */
export function useCatalogs() {
  const codex = useCodexModels();
  const claude = useClaudeModels();
  const picks = useAgentPicks();
  const modelsOf = (p: AgentProvider) =>
    p === "codex"
      ? codex.models
      : p === "claude"
        ? claude.models
        : picks.catalogs[p]?.models;
  const effortsOf = (p: AgentProvider, model: string): ReasoningEffort[] =>
    p === "codex"
      ? reasoningEffortsFor(model, codex.models)
      : p === "claude"
        ? claudeEffortsFor(claude.models, model)
        : (picks.catalogs[p]?.models?.find((m) => m.id === model)?.efforts ??
          []);
  const refresh = () => {
    codex.refresh();
    claude.refresh();
    picks.refresh();
  };
  return { modelsOf, effortsOf, refresh };
}
