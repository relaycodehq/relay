import { streamedIfReal } from "../../../shared/usage";
import type { UsageReport } from "../types";

type Counts = {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
  /** "fast" when the request ran in fast mode. */
  speed?: string | null;
  /** How much of the output was thinking; older CLIs leave it out. */
  output_tokens_details?: { thinking_tokens?: number | null } | null;
};

/** A stream frame as both the SDK and `claude --print` send it. */
type Frame = {
  type: string;
  parent_tool_use_id?: string | null;
  event?: {
    type: string;
    message?: { model?: string; usage?: Counts };
    content_block?: { type?: string };
    usage?: Counts;
  };
};

const defined = (c: Counts | undefined): Counts =>
  Object.fromEntries(
    Object.entries(c ?? {}).filter(
      ([, v]) => typeof v === "number" || typeof v === "string",
    ),
  );

const thinking = new Set(["thinking", "redacted_thinking"]);

type OpenRequest = {
  model: string;
  usage: Counts;
  /** Time spent in the blocks that aren't thinking, and when the open one began. */
  shownMs: number;
  showing?: number;
  thought?: boolean;
};

/**
 * Claude's requests as each one finishes, the main thread's and every
 * subagent's: `message_start` names the model and counts the input,
 * `message_delta` brings the final counts. Its speed counts only what it
 * showed, text and tool calls, the way Codex's has to: Codex can't time its
 * reasoning, so Claude's thinking is left out too.
 */
export class RequestUsage {
  /** The request each stream (main, or a subagent's call) has open. */
  private open = new Map<string, OpenRequest>();

  constructor(private now = Date.now) {}

  observe(frame: Frame, report: ((usage: UsageReport) => void) | undefined) {
    if (frame.type !== "stream_event" || !frame.event) return;
    const key = frame.parent_tool_use_id ?? "main";
    const event = frame.event;
    if (event.type === "message_start" && event.message?.model)
      this.open.set(key, {
        model: event.message.model,
        usage: defined(event.message.usage),
        shownMs: 0,
      });
    const start = this.open.get(key);
    if (!start) return;
    if (event.type === "content_block_start") {
      if (thinking.has(event.content_block?.type ?? "")) start.thought = true;
      else start.showing = this.now();
    }
    if (
      (event.type === "content_block_stop" || event.type === "message_delta") &&
      start.showing !== undefined
    ) {
      start.shownMs += this.now() - start.showing;
      start.showing = undefined;
    }
    if (event.type === "message_delta") {
      this.open.delete(key);
      // Older CLIs send only the output in the delta.
      const u = { ...start.usage, ...defined(event.usage) };
      const output = u.output_tokens ?? 0;
      const thought = event.usage?.output_tokens_details?.thinking_tokens;
      // A CLI that doesn't say how much was thinking can't be timed.
      const timed =
        start.thought && thought == null
          ? undefined
          : streamedIfReal(output - (thought ?? 0), start.shownMs);
      report?.({
        model: start.model,
        tokens: {
          input: u.input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          output,
        },
        ...(u.speed === "fast" ? { fast: true } : {}),
        ...(timed ? { streamed: timed } : {}),
        ...(key !== "main" ? { subagent: true } : {}),
      });
    }
  }
}
