import type {
  ModelUsage,
  SDKAssistantMessage,
  SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import {
  categoryKind,
  contextSourceLabel,
  type ContextItem,
  type ContextReport,
} from "../../../../shared/context-report";
import type { ContextUsage, PromptCache } from "../../../../shared/projects";
import type { ClaudeRunOptions } from "./config";
import type { ClaudeSession } from "./session";

/** How full a turn's context window is, and how long its cache stays warm. */
export class ContextMeter {
  private context?: ContextUsage;
  private cache?: PromptCache;
  // The cache is read when a request starts, not when its reply arrives.
  private request?: { id: string; at: number };

  constructor(
    private options: ClaudeRunOptions,
    private session: Pick<ClaudeSession, "contextWindow" | "cacheTtl">,
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
    this.context = {
      usedTokens,
      ...(this.session.contextWindow
        ? { maxTokens: this.session.contextWindow }
        : {}),
      ...(this.cache ? { cache: this.cache } : {}),
    };
    this.options.onContext?.(this.context);
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

/** Claude Code's live /context counts, in the shape its markdown reads into. */
export function claudeContextReport(
  usage: SDKControlGetContextUsageResponse,
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
  };
}
