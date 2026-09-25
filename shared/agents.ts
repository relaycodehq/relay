import { z } from "zod";
import type { ReasoningEffort } from "./settings";

/** Every agent a thread can talk to, in the order Relay offers them. */
export const agentProviders = ["codex", "claude", "opencode"] as const;
export const agentProviderSchema = z.enum(agentProviders);
export type AgentProvider = z.infer<typeof agentProviderSchema>;

export interface AgentInfo {
  name: string;
  /** Model picker placeholder when no model is picked. */
  defaultModel: string;
  /**
   * Runs Relay's own helper jobs besides threads: grouping changes, line
   * questions, shared rooms, commit messages and thread titles.
   */
  helper: boolean;
  /** Can lead a deep review with its own review command. */
  reviewer: boolean;
  /** Codex's Fast service tier. */
  fast: boolean;
  /** Codex skills, picked with `$name` or `/skill:name`. */
  skills: boolean;
  /** Its slash commands only run when the message starts with one, so they go out alone. */
  commandsAlone: boolean;
  /** Compaction takes instructions for what the summary should keep. */
  compactInstructions: boolean;
  /** Reports plan usage windows for the usage ring. */
  usage: boolean;
  /** Lists models from many upstream providers, so the picker groups them. */
  modelGroups: boolean;
}

export const agents: Record<AgentProvider, AgentInfo> = {
  codex: {
    name: "Codex",
    defaultModel: "Codex default",
    helper: true,
    reviewer: true,
    fast: true,
    skills: true,
    commandsAlone: false,
    compactInstructions: false,
    usage: true,
    modelGroups: false,
  },
  claude: {
    name: "Claude",
    defaultModel: "Claude default",
    helper: true,
    reviewer: true,
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: true,
    usage: true,
    modelGroups: false,
  },
  opencode: {
    name: "OpenCode",
    defaultModel: "OpenCode default",
    helper: false,
    reviewer: false,
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    usage: false,
    modelGroups: true,
  },
};

export const agentName = (provider: AgentProvider) => agents[provider].name;

/** Agents that run Relay's helper jobs, see `AgentInfo.helper`. */
export const helperProviders = agentProviders.filter((p) => agents[p].helper);
export type HelperProvider = "codex" | "claude";
export const helperProviderSchema = z
  .enum(["codex", "claude"])
  .refine((p) => agents[p].helper, "This agent can't run this job.");
/** Helper jobs fall back through the other helpers when one is unavailable. */
export const helperFallbacks = (first: HelperProvider): HelperProvider[] => [
  first,
  ...(helperProviders as HelperProvider[]).filter((p) => p !== first),
];

export const isAgentProvider = (value: unknown): value is AgentProvider =>
  agentProviderSchema.safeParse(value).success;

/** `@codex`, `@claude`, … at the start of a message. */
export const agentMentionPattern = new RegExp(
  `^@(${agentProviders.join("|")})(?=\\s|$)\\s*`,
  "i",
);

/** A model an agent offers, as its CLI or server lists it. */
export interface AgentModel {
  id: string;
  name: string;
  description: string;
  efforts: ReasoningEffort[];
  /** The agent suggests moving to a newer model. */
  legacy?: boolean;
  /** The effort it runs when none is set. */
  defaultEffort?: ReasoningEffort;
  /** Groups the picker's list, e.g. by OpenCode's upstream provider. */
  group?: string;
  /** Its context window in tokens, where the agent says. */
  contextWindow?: number;
}
/** What an agent runs where a thread leaves the model or effort on Default. */
export interface AgentDefaults {
  /** "" leaves the agent's built-in choice. */
  model: string;
  effort: ReasoningEffort;
}
