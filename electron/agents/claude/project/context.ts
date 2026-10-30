import type {
  ModelUsage,
  Options,
  SDKAssistantMessage,
  SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import {
  categoryKind,
  contextSourceLabel,
  type ContextItem,
  type ContextReport,
  type RelayShare,
} from "../../../../shared/context-report";
import type { ContextUsage, PromptCache } from "../../../../shared/projects";
import type { ClaudeRunOptions } from "./config";
import { RELAY_SERVER } from "../../../relay-mcp";
import type { ClaudeSession } from "./session";

/** How full a turn's context window is, and how long its cache stays warm. */
export class ContextMeter {
  private context?: ContextUsage;
  private cache?: PromptCache;
  // The cache is read when a request starts, not when its reply arrives.
  private request?: { id: string; at: number };

  constructor(
    private options: ClaudeRunOptions,
    private session: Pick<
      ClaudeSession,
      "contextWindow" | "usableWindow" | "cacheTtl"
    >,
  ) {}

  /** A request for message `id` went out. */
  started(id: string) {
    this.request = { id, at: Date.now() };
  }

  /** The main conversation's reply, with what its request used. */
  replied(message: SDKAssistantMessage["message"]) {
    const usage = message.usage;
    this.session.cacheTtl = claudeCacheTtl(usage, this.session.cacheTtl);
    if (this.session.cacheTtl)
      this.cache = {
        at: this.request?.id === message.id ? this.request.at : Date.now(),
        ttlMs: this.session.cacheTtl,
      };
    this.report(claudeContextTokens(usage));
  }

  compacted(postTokens: number) {
    // The summary replaces the conversation the cache held.
    this.cache = undefined;
    this.report(postTokens);
  }

  /** The turn's result: the window each model ran with, and the session's running total. */
  finished(modelUsage: Record<string, ModelUsage> | undefined) {
    const windows = Object.values(modelUsage ?? {})
      .map((usage) => usage.contextWindow)
      .filter((size) => size > 0);
    if (windows.length) {
      this.session.contextWindow = Math.max(...windows);
      if (this.context) this.report(this.context.usedTokens);
    }
    const total = claudeSessionTokens(modelUsage);
    if (this.context && total) {
      this.context = { ...this.context, totalTokens: total };
      this.options.onContext?.(this.context);
    }
  }

  private report(usedTokens: number) {
    if (!(usedTokens > 0)) return;
    const window = this.shownWindow();
    this.context = {
      usedTokens,
      ...(window ? { maxTokens: window } : {}),
      ...(this.cache ? { cache: this.cache } : {}),
    };
    this.options.onContext?.(this.context);
  }

  /** The model's window, or less when Claude Code compacts before it fills. */
  private shownWindow() {
    const { contextWindow, usableWindow } = this.session;
    if (!contextWindow || !usableWindow) return contextWindow ?? usableWindow;
    return Math.min(contextWindow, usableWindow);
  }
}

const CACHE_5M = 5 * 60_000;
const CACHE_1H = 60 * 60_000;

/**
 * How long the conversation stays cached after this request: five minutes by
 * default, an hour when Claude Code asks for it. Requests that only read the
 * cache don't say, so they keep the lifetime the session already wrote with.
 */
export function claudeCacheTtl(
  usage: unknown,
  known?: number,
): number | undefined {
  if (!usage || typeof usage !== "object") return known;
  const u = usage as Record<string, any>;
  if (u.cache_creation?.ephemeral_1h_input_tokens > 0) return CACHE_1H;
  if (u.cache_creation?.ephemeral_5m_input_tokens > 0) return CACHE_5M;
  if (known) return known;
  if (u.cache_creation_input_tokens > 0 || u.cache_read_input_tokens > 0)
    return CACHE_5M;
}

/** Tokens the session processed so far, subagents and cache reads included. */
function claudeSessionTokens(modelUsage: Record<string, ModelUsage> = {}) {
  return Object.values(modelUsage).reduce(
    (sum, u) =>
      sum +
      u.inputTokens +
      u.outputTokens +
      u.cacheReadInputTokens +
      u.cacheCreationInputTokens,
    0,
  );
}

/** A request's prompt plus its reply is what the next request carries forward. */
export function claudeContextTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const count = (key: string) =>
    typeof u[key] === "number" && Number.isFinite(u[key])
      ? (u[key] as number)
      : 0;
  return (
    count("input_tokens") +
    count("cache_creation_input_tokens") +
    count("cache_read_input_tokens") +
    count("output_tokens")
  );
}

/**
 * Roughly what Relay's addition to the system prompt costs. Claude Code counts
 * the prompt as a whole, so Relay estimates its own part, at about four
 * characters a token.
 */
export function relayPromptTokens(config: Options) {
  const prompt = config.systemPrompt;
  const append =
    typeof prompt === "object" &&
    !Array.isArray(prompt) &&
    prompt.type === "preset"
      ? prompt.append
      : undefined;
  return append ? Math.ceil(append.length / 4) : 0;
}

function relayShare(
  usage: SDKControlGetContextUsageResponse,
  instructions: number,
): RelayShare {
  const tools = usage.mcpTools.filter((t) => t.serverName === RELAY_SERVER);
  // `isLoaded` reads false for every tool when none are deferred.
  const deferring = usage.categories.some(
    (c) => /^MCP tools/.test(c.name) && (c.kind === "deferred" || c.isDeferred),
  );
  return {
    instructions,
    notes:
      usage.messageBreakdown?.attachmentsByType.find(
        (a) => a.name === "hook_additional_context",
      )?.tokens ?? 0,
    tools: tools.map((t) => ({ name: t.name, tokens: t.tokens })),
    loaded: tools
      .filter((t) => !deferring || t.isLoaded)
      .reduce((sum, t) => sum + t.tokens, 0),
  };
}

/**
 * Claude Code's live /context counts, in the shape its markdown reads into,
 * and Relay's share of them.
 */
export function claudeContextReport(
  usage: SDKControlGetContextUsageResponse,
  relayPrompt = 0,
): ContextReport {
  const items = <T>(
    list: T[] | undefined,
    pick: (item: T) => ContextItem,
  ): ContextItem[] => (list ?? []).map(pick).filter((item) => item.tokens > 0);
  return {
    model: usage.model,
    totalTokens: usage.totalTokens,
    maxTokens: usage.rawMaxTokens || usage.maxTokens,
    ...(usage.isAutoCompactEnabled && usage.autoCompactThreshold
      ? { compactsAt: usage.autoCompactThreshold }
      : {}),
    categories: usage.categories
      .filter((c) => c.tokens > 0)
      .map((c) => ({
        name: c.name,
        tokens: c.tokens,
        kind: categoryKind(c.name, c.kind, c.isDeferred),
      })),
    memoryFiles: items(usage.memoryFiles, (f) => ({
      name: f.path,
      source: f.type,
      tokens: f.tokens,
    })),
    mcpTools: items(usage.mcpTools, (t) => ({
      name: t.name,
      source: t.serverName,
      tokens: t.tokens,
    })),
    agents: items(usage.agents, (a) => ({
      name: a.agentType,
      source: contextSourceLabel(a.source),
      tokens: a.tokens,
    })),
    skills: items(usage.skills?.skillFrontmatter, (s) => ({
      name: s.name,
      source: contextSourceLabel(s.source),
      tokens: s.tokens,
    })),
    relay: relayShare(usage, relayPrompt),
  };
}
