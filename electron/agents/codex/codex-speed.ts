import { streamedIfReal, type Streamed } from "../../../shared/usage";
import type { CodexNotification } from "./codex-schemas";

/** Items that stream as the model writes them. */
const streaming = new Set(["agentMessage", "plan"]);

/** Items that arrive whole, once the model has written all of them. */
const whole = new Set([
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
 * streamed to the last thing it showed, over the output that isn't reasoning.
 * A tool call arrives only once it's written, so a request that shows one
 * before streaming anything wrote it before the clock could start: it can't
 * be timed.
 */
export class CodexRequestSpeed {
  private first?: number;
  private last?: number;
  private wroteUnseen = false;

  constructor(private now = Date.now) {}

  observe(n: CodexNotification) {
    const streamed =
      n.method === "item/agentMessage/delta" ||
      n.method === "item/plan/delta" ||
      (n.method === "item/started" && streaming.has(n.params.item.type));
    const arrivedWhole =
      n.method === "item/started" && whole.has(n.params.item.type);
    if (arrivedWhole && this.first === undefined) this.wroteUnseen = true;
    if (!streamed && !arrivedWhole) return;
    this.first ??= this.now();
    this.last = this.now();
  }

  /** The request that just reported its counts; the next one starts afresh. */
  finish(usage: {
    outputTokens?: number;
    reasoningOutputTokens?: number;
  }): Streamed | undefined {
    const { first, last, wroteUnseen } = this;
    this.first = this.last = undefined;
    this.wroteUnseen = false;
    if (first === undefined || last === undefined || wroteUnseen) return;
    const shown =
      (usage.outputTokens ?? 0) - (usage.reasoningOutputTokens ?? 0);
    return streamedIfReal(shown, last - first);
  }
}
