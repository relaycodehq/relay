import type { AgentProvider } from "./agents";
import type { AISettings } from "./settings";

type AgentPrefs = Pick<AISettings, "agentOrder" | "agentsOff">;

/** `agents` in the order Settings keeps, the ones it hasn't placed after in their own order. */
export function inAgentOrder<T extends AgentProvider>(
  agents: readonly T[],
  order: readonly AgentProvider[] = [],
): T[] {
  const placed = order.filter((p): p is T => agents.includes(p as T));
  return [...new Set(placed), ...agents.filter((p) => !placed.includes(p))];
}

export const agentOn = (
  prefs: Pick<AgentPrefs, "agentsOff"> | undefined,
  provider: AgentProvider,
) => !prefs?.agentsOff?.includes(provider);

/**
 * What a picker offers: `agents` in Settings' order without the ones switched
 * off, except those in `keep`, such as the agent a composer is on now.
 */
export function offeredAgents<T extends AgentProvider>(
  agents: readonly T[],
  prefs: AgentPrefs | undefined,
  keep: readonly (AgentProvider | undefined)[] = [],
): T[] {
  return inAgentOrder(agents, prefs?.agentOrder).filter(
    (p) => agentOn(prefs, p) || keep.includes(p),
  );
}
