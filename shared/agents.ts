import { z } from "zod";
import type { ReasoningEffort } from "./settings";

/** Every agent a thread can talk to, in the order Relay offers them. */
export const agentProviders = [
  "codex",
  "claude",
  "opencode",
  "cursor",
] as const;
export const agentProviderSchema = z.enum(agentProviders);
export type AgentProvider = z.infer<typeof agentProviderSchema>;

export interface AgentInfo {
  name: string;
  /** The program Relay runs, as its makers call it. */
  cli: string;
  /** Model picker placeholder when no model is picked. */
  defaultModel: string;
  /**
   * Runs Relay's own helper jobs besides threads: grouping changes, line
   * questions, shared rooms, commit messages, and thread titles when a
   * thread's own agent can't write one.
   */
  helper: boolean;
  /**
   * How a deep review's reviewers review with it: its own command, or a
   * description of Relay's prompt for agents without one. Only an agent that can
   * read a diff without changing anything can review.
   */
  reviewCommand?: string;
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
  /** Runs from an SDK Relay downloads, not a CLI it finds on the machine. */
  sdk?: true;
}

export const agents = {
  codex: {
    name: "Codex",
    cli: "Codex CLI",
    defaultModel: "Codex default",
    helper: true,
    reviewCommand: "/review",
    fast: true,
    skills: true,
    commandsAlone: false,
    compactInstructions: false,
    usage: true,
    modelGroups: false,
  },
  claude: {
    name: "Claude",
    cli: "Claude Code",
    defaultModel: "Claude default",
    helper: true,
    reviewCommand: "/code-review",
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: true,
    usage: true,
    modelGroups: false,
  },
  opencode: {
    name: "OpenCode",
    cli: "OpenCode",
    defaultModel: "OpenCode default",
    helper: false,
    reviewCommand: "Relay's review prompt",
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    usage: false,
    modelGroups: true,
  },
  cursor: {
    name: "Cursor",
    cli: "Cursor SDK",
    defaultModel: "Cursor default",
    helper: false,
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    usage: false,
    modelGroups: true,
    sdk: true,
  },
} as const satisfies Record<AgentProvider, AgentInfo>;

export const agentName = (provider: AgentProvider) => agents[provider].name;

/** The agents with `AgentInfo` field `K` on, as a type. */
type AgentsWith<K extends keyof AgentInfo> = {
  [P in AgentProvider]: (typeof agents)[P] extends Record<K, true | string>
    ? P
    : never;
}[AgentProvider];
/** The agents with field `K` on, and a schema that accepts only them. */
function agentsWith<K extends keyof AgentInfo>(key: K) {
  const list = agentProviders.filter(
    (p): p is AgentsWith<K> => !!(agents[p] as AgentInfo)[key],
  );
  return { list, schema: z.enum(list as [AgentsWith<K>, ...AgentsWith<K>[]]) };
}

/** Agents Relay runs from a CLI it finds; the rest run from an SDK it downloads. */
export type CliProvider = Exclude<AgentProvider, AgentsWith<"sdk">>;
export const isCliProvider = (
  provider: AgentProvider,
): provider is CliProvider => !(agents[provider] as AgentInfo).sdk;

const helpers = agentsWith("helper");
/** Agents that run Relay's helper jobs, see `AgentInfo.helper`. */
export const helperProviders = helpers.list;
export type HelperProvider = AgentsWith<"helper">;
export const helperProviderSchema = helpers.schema;
/**
 * Helper jobs fall back through the other helpers when one is unavailable. The
 * first may be any agent that can answer a prompt with text, such as one that
 * splits commits.
 */
export const helperFallbacks = (first: AgentProvider): AgentProvider[] => [
  first,
  ...helperProviders.filter((p) => p !== first),
];
/** Agents that report plan usage, see `AgentInfo.usage`. */
export type UsageProvider = AgentsWith<"usage">;
export const usageProviders = agentsWith("usage").list;
export const usageProviderSchema = agentsWith("usage").schema;
export const reportsUsage = (p: string): p is UsageProvider =>
  usageProviders.some((u) => u === p);
/** Agents a deep review can ask, see `AgentInfo.reviewCommand`. */
export type ReviewerProvider = AgentsWith<"reviewCommand">;
export const reviewerProviderSchema = agentsWith("reviewCommand").schema;
export const reviewerProviders = agentsWith("reviewCommand").list;

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
/** What an agent runs where a thread leaves the model or effort on Default. */
export interface AgentDefaults {
  /** The listed model Default runs; "" when the agent doesn't say. */
  model: string;
  /** The effort Default runs on that model; "" when it sends none or doesn't say. */
  effort: ReasoningEffort;
  /** The effort Default runs with each listed model picked, by model id. */
  efforts?: Record<string, ReasoningEffort>;
}
