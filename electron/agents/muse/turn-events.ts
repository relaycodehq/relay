import { CodexPlanRows } from "../activity";
import { answerLimitError, TurnEnd, TurnText } from "../turn-kit";
import type { AgentOptions } from "../types";
import { museActivity, museEditedPaths, todoPlan } from "./activity";
import type { MuseConnection } from "./connection";
import {
  contextUsageSchema,
  itemSchema,
  todoListSchema,
  tokenUsageNoticeSchema,
  turnCompletedSchema,
  type MuseItem,
  type MuseTokenUsage,
  type MuseTurnCompleted,
} from "./protocol";
import { MuseRequests } from "./requests";
import { MuseSubagents, museSubagentBooks } from "./subagents";
import { museUsageSeen } from "./usage";

/** Muse's token counts as Relay's: input left after the cache. */
function tokensOf(usage: MuseTokenUsage) {
  const cacheRead = usage.cacheReadTokens ?? usage.cachedTokens;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return {
    input: Math.max(0, usage.inputTokens - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: usage.outputTokens,
  };
}

/**
 * What `muse serve` says during one turn, put to the thread as it comes,
 * with the questions it asks and the subagents it runs.
 */
export class MuseTurnEvents {
  readonly turn: TurnText;
  readonly ended = new TurnEnd<MuseTurnCompleted | "compacted">();
  /** Steering sent, by the command id Muse echoes on the message it reads. */
  readonly steers = new Map<string, string>();
  readonly requests: MuseRequests;
  readonly subagents: MuseSubagents;
  sessionId: string | undefined;
  turnId: string | undefined;
  /** The conversation's last compaction, which a /compact reports. */
  compaction: MuseItem | undefined;
  private plans = new CodexPlanRows();
  /** Each answer item's text so far, so a completed item adds only what its deltas missed. */
  private said = new Map<string, number>();
  /** The answer item text last went to; another one after it is a new paragraph. */
  private speaking: string | undefined;

  constructor(
    connection: MuseConnection,
    private options: AgentOptions,
    key: string | undefined,
    turnSignal: AbortSignal,
    /** The answer outgrew its limit: stop the turn. */
    private interrupt: () => void,
  ) {
    this.turn = new TurnText(options.onText, options.onCommentary, "muse");
    this.requests = new MuseRequests(connection, options, turnSignal);
    this.subagents = new MuseSubagents(
      connection,
      () => this.sessionId,
      (activity) => options.onActivity?.(activity),
      key ? museSubagentBooks.open(key) : undefined,
    );
  }

  fail = (error: Error) => this.ended.fail(error);

  private complete(done: MuseTurnCompleted | "compacted") {
    this.ended.succeed(done);
  }

  notification = (method: string, params: unknown) => {
    const { options } = this;
    if (this.subagents.notification(method, params)) return;
    const p = (params ?? {}) as Record<string, unknown>;
    if (
      this.sessionId &&
      p.sessionId !== undefined &&
      p.sessionId !== this.sessionId
    )
      return;
    if (this.requests.notification(method, params)) return;
    switch (method) {
      case "item/started":
      case "item/updated":
      case "item/completed": {
        const item = itemSchema.safeParse(p.item);
        if (item.success) this.hearItem(method, item.data);
        return;
      }
      case "item/delta": {
        const id = typeof p.itemId === "string" ? p.itemId : "";
        const field = typeof p.field === "string" ? p.field : "text";
        // Only answer text streams in; tool output shows once a call ends.
        if (field === "text" && typeof p.delta === "string")
          this.addText(id, p.delta);
        return;
      }
      case "session/tokenUsage": {
        const usage = tokenUsageNoticeSchema.safeParse(params);
        if (
          usage.success &&
          (!this.turnId ||
            !usage.data.turnId ||
            usage.data.turnId === this.turnId)
        )
          options.onUsage?.({
            model: usage.data.modelId || options.choice.model || "muse",
            tokens: tokensOf(usage.data.usage),
          });
        return;
      }
      case "session/contextUsage": {
        const usage = contextUsageSchema.safeParse(params);
        if (usage.success)
          options.onContext?.({
            usedTokens: usage.data.usedTokens,
            ...(usage.data.windowTokens && {
              maxTokens: usage.data.windowTokens,
            }),
          });
        return;
      }
      case "session/todoListChanged": {
        const todos = todoListSchema.safeParse(params);
        const row =
          todos.success && this.sessionId
            ? this.plans.update(this.sessionId, todoPlan(todos.data.items))
            : undefined;
        if (row) options.onActivity?.(row);
        return;
      }
      case "session/nameChanged":
        if (typeof p.name === "string" && p.name.trim())
          options.onTitle?.(p.name.trim());
        return;
      case "usage/changed":
        museUsageSeen(params);
        return;
      case "turn/retryScheduled":
        if (p.turnId === this.turnId)
          options.onCommentary?.(
            "muse-retry",
            `Muse Code is retrying (attempt ${String(p.nextAttempt ?? "")} of ${String(p.maxAttempts ?? "")})${typeof p.reason === "string" && p.reason ? `: ${p.reason}` : ""}.`,
          );
        return;
      case "turn/started":
        if (p.turnId === this.turnId)
          options.onCommentary?.("muse-retry", null);
        return;
      case "turn/completed": {
        const done = turnCompletedSchema.safeParse(params);
        if (!done.success || done.data.turnId !== this.turnId) return;
        return this.complete(done.data);
      }
      case "session/closed":
        this.fail(new Error("Muse Code closed the session."));
        return;
    }
  };

  dispose() {
    this.requests.dispose();
    this.subagents.dispose();
  }

  private addText(itemId: string, text: string) {
    if (!text) return;
    this.said.set(itemId, (this.said.get(itemId) ?? 0) + text.length);
    if (this.speaking && this.speaking !== itemId) this.turn.add("\n\n");
    this.speaking = itemId;
    this.turn.add(text);
    const over = answerLimitError(this.turn.size);
    if (over) {
      this.fail(over);
      this.interrupt();
    }
  }

  private ours(item: MuseItem) {
    return !this.turnId || !item.turnId || item.turnId === this.turnId;
  }

  private hearItem(method: string, item: MuseItem) {
    const { options } = this;
    if (!this.ours(item)) return;
    if (item.kind === "userMessage") {
      const steer = item.commandId && this.steers.get(item.commandId);
      if (item.steered && steer) {
        this.turn.reset();
        this.speaking = undefined;
        options.onSteered?.(steer);
      }
      return;
    }
    if (item.kind === "agentMessage") {
      if (method === "item/completed" && item.text)
        this.addText(
          item.itemId,
          item.text.slice(this.said.get(item.itemId) ?? 0),
        );
      return;
    }
    if (item.kind === "toolCall" && method === "item/started") {
      this.turn.toCommentary();
      this.speaking = undefined;
      const paths = museEditedPaths(item);
      if (paths.length) options.onEdit?.(paths);
    }
    if (item.kind === "subagent") {
      this.turn.toCommentary();
      this.speaking = undefined;
      this.subagents.item(item);
    }
    if (item.kind === "compaction") {
      this.compaction = item;
      // A /compact shows as its own line in the thread, not inside a turn.
      if (options.job.kind === "compact") {
        if (item.status !== "inProgress") this.complete("compacted");
        return;
      }
    }
    const activity = museActivity(item);
    if (activity) options.onActivity?.(activity);
  }
}
