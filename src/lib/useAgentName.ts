import { findClaudeModel, effortLabels } from "../../shared/settings";
import { agents, type AgentProvider } from "../../shared/agents";
import type { LeadAgent, ReviewAgent } from "../../shared/deep-review";
import { useClaudeModels } from "./useClaudeModels";
import { useCodexModels } from "./useCodexModels";

/** Names an agent by its model, as the pickers do. */
export function useAgentName() {
  const claude = useClaudeModels().models;
  const codex = useCodexModels().models;
  return (agent: { provider: AgentProvider; choice: ReviewAgent["choice"] }) =>
    agent.provider === "codex"
      ? (codex.find((m) => m.id === agent.choice.model)?.name ??
        (agent.choice.model || "Codex default"))
      : agent.provider === "claude"
        ? (findClaudeModel(claude, agent.choice.model)?.name ??
          (agent.choice.model || "Claude default"))
        : agent.choice.model || agents[agent.provider].defaultModel;
}

export const effortName = (agent: ReviewAgent | LeadAgent) =>
  agent.choice.reasoningEffort
    ? effortLabels[agent.choice.reasoningEffort]
    : "Default";
