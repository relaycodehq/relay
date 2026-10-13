import type { AgentProvider } from "../../../shared/agents";
import { modelEfforts } from "../../../shared/composer-commands";
import { supportsFast } from "../../../shared/model-fit";
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
  const effortsOf = (p: AgentProvider, model: string) =>
    modelEfforts(p, model, { [p]: modelsOf(p) });
  const refresh = () => {
    codex.refresh();
    claude.refresh();
    picks.refresh();
  };
  const offersFast = (p: AgentProvider, model: string) =>
    supportsFast(p, model, modelsOf(p));
  return { modelsOf, effortsOf, offersFast, refresh };
}
