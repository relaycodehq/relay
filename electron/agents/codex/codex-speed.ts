import { streamedIfReal, type Streamed } from "../../../shared/usage";
import type { CodexNotification } from "./codex-schemas";

/** Items the model writes; a tool call's shows up once the call is written. */
const written = new Set([
  "agentMessage",
  "plan",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  // How multi-agent v2 shows a spawn.
  "subAgentActivity",
  "webSearch",
  "imageView",
  "imageGeneration",
]);

/**
 * How fast a Codex request wrote what it showed. Codex reports a request's
 * counts only once the tools it called have run, and its reasoning can arrive
 * all at once at its end, so the clock runs from the first thing the request
 * showed to the last, over the output that isn't reasoning.
 */
export class CodexRequestSpeed {
  private first?: number;
  private last?: number;

  constructor(private now = Date.now) {}

  observe(n: CodexNotification) {
    const wrote =
      n.method === "item/agentMessage/delta" ||
      n.method === "item/plan/delta" ||
      (n.method === "item/started" && written.has(n.params.item.type));
    if (!wrote) return;
    this.first ??= this.now();
    this.last = this.now();
  }

  /** The request that just reported its counts; the next one starts afresh. */
  finish(usage: {
    outputTokens?: number;
    reasoningOutputTokens?: number;
  }): Streamed | undefined {
    const { first, last } = this;
    this.first = this.last = undefined;
    if (first === undefined || last === undefined) return;
    const shown =
      (usage.outputTokens ?? 0) - (usage.reasoningOutputTokens ?? 0);
    return streamedIfReal(shown, last - first);
  }
}
