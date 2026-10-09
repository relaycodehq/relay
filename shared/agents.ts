import { z } from "zod";
import type { ReasoningEffort } from "./settings";

/** The agents built into Relay, in the order it offers them. */
export const agentProviders = [
  "codex",
  "claude",
  "opencode",
  "cursor",
  "amp",
  "antigravity",
] as const;
export type BuiltinProvider = (typeof agentProviders)[number];
/** An agent Relay installed from the ACP registry, by its registry id: `acp:goose`. */
export type RegistryProvider = `acp:${string}`;
/** Every agent a thread can talk to: Relay's own, and those added from the ACP registry. */
export type AgentProvider = BuiltinProvider | RegistryProvider;

/** The ACP registry's agent ids. */
export const registryIdPattern = /^[a-z0-9][a-z0-9-]*$/;
export const registryProviderSchema = z.templateLiteral([
  "acp:",
  z.string().regex(registryIdPattern),
]);
export const agentProviderSchema = z.union([
  z.enum(agentProviders),
  registryProviderSchema,
]);
export const isRegistryProvider = (
  provider: AgentProvider,
): provider is RegistryProvider => provider.startsWith("acp:");
export const registryProvider = (id: string): RegistryProvider => `acp:${id}`;
export const registryIdOf = (provider: RegistryProvider) => provider.slice(4);

export interface AgentInfo {
  name: string;
  /** The program Relay runs, as its makers call it. */
  cli: string;
  /** Model picker placeholder when no model is picked. */
  defaultModel: string;
  /**
   * Runs Relay's own helper jobs besides threads: grouping changes, line
   * questions, commit messages, and thread titles when a
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
  /**
   * A thread's session runs in a process of its own, so restarting it on the
   * same conversation loads skills, plugins and instructions changed since.
   */
  reload: boolean;
  /** Reports plan usage windows for the usage ring. */
  usage: boolean;
  /** Lists models from many upstream providers, so the picker groups them. */
  modelGroups: boolean;
  /** Runs from something Relay downloads (an SDK, a server), not a CLI it finds on the machine. */
  sdk?: true;
  /**
   * The CLI's own sign-in, as arguments to run in a terminal. Agents without
   * one sign in through Relay: Settings → Agents.
   */
  login?: string;
}

export const agents = {
  codex: {
    login: "login",
    name: "Codex",
    cli: "Codex CLI",
    defaultModel: "Codex default",
    helper: true,
    reviewCommand: "/review",
    fast: true,
    skills: true,
    commandsAlone: false,
    compactInstructions: false,
    reload: true,
    usage: true,
    modelGroups: false,
  },
  claude: {
    login: "auth login",
    name: "Claude",
    cli: "Claude Code",
    defaultModel: "Claude default",
    helper: true,
    reviewCommand: "/code-review",
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: true,
    reload: true,
    usage: true,
    modelGroups: false,
  },
  opencode: {
    login: "auth login",
    name: "OpenCode",
    cli: "OpenCode",
    defaultModel: "OpenCode default",
    helper: false,
    reviewCommand: "Relay's review prompt",
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    reload: false,
    usage: false,
    modelGroups: true,
  },
  cursor: {
    name: "Cursor",
    cli: "Cursor SDK",
    defaultModel: "Cursor default",
    helper: false,
    reviewCommand: "/review-bugbot",
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    reload: true,
    usage: false,
    modelGroups: true,
    sdk: true,
  },
  amp: {
    login: "login",
    name: "Amp",
    cli: "Amp CLI",
    defaultModel: "Amp default",
    helper: false,
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    reload: true,
    usage: false,
    modelGroups: false,
  },
  antigravity: {
    // Google's ACP server, downloaded by Relay; it signs in through Relay over ACP.
    name: "Antigravity",
    cli: "Antigravity",
    defaultModel: "Antigravity default",
    helper: false,
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    reload: true,
    usage: false,
    modelGroups: false,
    sdk: true,
  },
} as const satisfies Record<BuiltinProvider, AgentInfo>;

/** The registry agents this Relay installed, and their names as the registry gives them. */
const registryNames = new Map<RegistryProvider, string>();
let runnable: readonly AgentProvider[] = agentProviders;
const listeners = new Set<() => void>();
/** Tells this process which registry agents are installed and what they're called. */
export function knowRegistryAgents(
  installed: { provider: RegistryProvider; name: string }[],
) {
  registryNames.clear();
  for (const { provider, name } of installed) registryNames.set(provider, name);
  runnable = [...agentProviders, ...registryNames.keys()];
  for (const listener of listeners) listener();
}
export function onRegistryAgents(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/**
 * Every agent a thread can run on here: Relay's own, then the registry
 * agents installed. The same array until that changes.
 */
export const runnableAgents = () => runnable;

/** `factory-droid` as "Factory Droid", for an agent whose name hasn't arrived. */
const nameFromId = (id: string) =>
  id.replace(
    /(^|-)([a-z])/g,
    (_, dash: string, c: string) => `${dash && " "}${c.toUpperCase()}`,
  );

/**
 * A registry agent is driven only through ACP: its models, modes and sign-in
 * are whatever it reports, and it runs none of Relay's own jobs.
 */
function registryInfo(provider: RegistryProvider): AgentInfo {
  const name =
    registryNames.get(provider) ?? nameFromId(registryIdOf(provider));
  return {
    name,
    cli: name,
    defaultModel: `${name} default`,
    helper: false,
    fast: false,
    skills: false,
    commandsAlone: true,
    compactInstructions: false,
    reload: true,
    usage: false,
    modelGroups: false,
    sdk: true,
  };
}

/**
 * An agent's profile, or nothing for one this build doesn't know: a newer
 * desktop can run agents an older phone (or desktop build) has never heard of.
 */
export function agentInfo(provider: AgentProvider): AgentInfo;
export function agentInfo(provider: string): AgentInfo | undefined;
export function agentInfo(provider: string): AgentInfo | undefined {
  if (!isAgentProvider(provider)) return undefined;
  return isRegistryProvider(provider)
    ? registryInfo(provider)
    : agents[provider];
}
export const agentName = (provider: AgentProvider) =>
  agentInfo(provider)?.name ?? provider;

/** The built-in agents with `AgentInfo` field `K` on, as a type. */
type AgentsWith<K extends keyof AgentInfo> = {
  [P in BuiltinProvider]: (typeof agents)[P] extends Record<K, true | string>
    ? P
    : never;
}[BuiltinProvider];
/** The agents with field `K` on, and a schema that accepts only them. */
function agentsWith<K extends keyof AgentInfo>(key: K) {
  const list = agentProviders.filter(
    (p): p is AgentsWith<K> => !!(agents[p] as AgentInfo)[key],
  );
  return { list, schema: z.enum(list as [AgentsWith<K>, ...AgentsWith<K>[]]) };
}

/** Agents Relay runs from a CLI it finds; the rest run from what it downloads. */
export type CliProvider = Exclude<BuiltinProvider, AgentsWith<"sdk">>;
export type SdkProvider = AgentsWith<"sdk"> | RegistryProvider;
export const isCliProvider = (
  provider: AgentProvider,
): provider is CliProvider => !agentInfo(provider).sdk;

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
export const reviewerProviderSchema = agentsWith("reviewCommand").schema;
export const reviewerProviders = agentsWith("reviewCommand").list;

export const isAgentProvider = (value: unknown): value is AgentProvider =>
  agentProviderSchema.safeParse(value).success;

/** `@codex`, `@claude`, … at the start of a message; registry agents have no mention. */
export const agentMentionPattern = new RegExp(
  `^@(${agentProviders.join("|")})(?=\\s|$)\\s*`,
  "i",
);

/** Only an explicit leading mention picks an agent. Quoted/code mentions are ordinary text. */
export function agentMention(
  text: string,
): { provider: AgentProvider; question: string } | null {
  const trimmed = text.trim();
  const m = agentMentionPattern.exec(trimmed);
  return m
    ? {
        provider: m[1].toLowerCase() as BuiltinProvider,
        question: trimmed.slice(m[0].length).trim(),
      }
    : null;
}

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
  /** The model id an alias stands for, e.g. `claude-opus-5-5` for Claude's `opus`. */
  resolved?: string;
}
/** What an agent runs where a thread leaves the model or effort on Default. */
export interface AgentDefaults {
  /** The listed model Default runs; "" when the agent doesn't say. */
  model: string;
  /** The effort Default runs on that model; "" when it sends none or doesn't say. */
  effort: ReasoningEffort;
  /** The effort Default runs with each listed model picked, by model id. */
  efforts?: Record<string, ReasoningEffort>;
}
