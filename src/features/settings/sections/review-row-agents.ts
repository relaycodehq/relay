import { offeredAgents } from "../../../../shared/agent-prefs";
import { helperProviders, type AgentProvider } from "../../../../shared/agents";
import type { AISettings, SwitchableHelper } from "../../../../shared/settings";

export interface ReviewRow {
  kind: SwitchableHelper;
  /** Runs on any agent, not only Codex and Claude. */
  anyAgent?: boolean;
}

/**
 * The agents a Used by Relay row offers, in Settings' order. Switched-off ones
 * are left out except the row's own, so it still shows what it runs on.
 */
export function reviewRowAgents(
  row: ReviewRow,
  settings: AISettings,
  runnable: readonly AgentProvider[],
): AgentProvider[] {
  const agents = row.anyAgent ? runnable : helperProviders;
  return offeredAgents(agents, settings, [settings[`${row.kind}Provider`]]);
}
