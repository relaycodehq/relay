import type { UsageReport } from "../types";

type Counts = {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
  /** "fast" when the request ran in fast mode. */
  speed?: string | null;
};

/** A stream frame as both the SDK and `claude --print` send it. */
type Frame = {
  type: string;
  parent_tool_use_id?: string | null;
  event?: {
    type: string;
    message?: { model?: string; usage?: Counts };
    usage?: Counts;
  };
};

const defined = (c: Counts | undefined): Counts =>
  Object.fromEntries(
    Object.entries(c ?? {}).filter(
      ([, v]) => typeof v === "number" || typeof v === "string",
    ),
  );

/**
 * Claude's requests as each one finishes, the main thread's and every
 * subagent's: `message_start` names the model and counts the input,
 * `message_delta` brings the final counts.
 */
export class RequestUsage {
  /** The request each stream (main, or a subagent's call) has open. */
  private open = new Map<string, { model: string; usage: Counts }>();

  observe(frame: Frame, report: ((usage: UsageReport) => void) | undefined) {
    if (frame.type !== "stream_event" || !frame.event) return;
    const key = frame.parent_tool_use_id ?? "main";
    const event = frame.event;
    if (event.type === "message_start" && event.message?.model)
      this.open.set(key, {
        model: event.message.model,
        usage: defined(event.message.usage),
      });
    if (event.type === "message_delta") {
      const start = this.open.get(key);
      if (!start) return;
      this.open.delete(key);
      // Older CLIs send only the output in the delta.
      const u = { ...start.usage, ...defined(event.usage) };
      report?.({
        model: start.model,
        tokens: {
          input: u.input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        },
        ...(u.speed === "fast" ? { fast: true } : {}),
      });
    }
  }
}
