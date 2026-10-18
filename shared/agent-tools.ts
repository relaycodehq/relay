/** An inspection of configuration, never a live connection or a permission grant. */
export type AgentToolSource =
  "repo" | "personal" | "plugins" | "builtin" | "managed" | "other";
export type AgentToolState = "enabled" | "disabled" | "unknown";
export interface AgentTool {
  id: string;
  name: string;
  description: string;
  source: AgentToolSource;
  state: AgentToolState;
  path?: string;
  detail?: string;
  transport?: string;
  /** Only a sanitized endpoint origin or executable name. No arguments or credentials. */
  summary?: string;
}
export interface AgentToolListing {
  items: AgentTool[];
  note?: string;
  error?: string;
}
export interface AgentTools {
  skills: AgentToolListing;
  servers: AgentToolListing;
  account?: string;
  checkedAt: number;
}
export const agentToolSources: { id: AgentToolSource; label: string }[] = [
  { id: "repo", label: "Repository" },
  { id: "personal", label: "Personal" },
  { id: "plugins", label: "Plugins" },
  { id: "builtin", label: "Built in" },
  { id: "managed", label: "Managed" },
  { id: "other", label: "Other" },
];
export const agentToolStates: Record<AgentToolState, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  unknown: "Unknown",
};
