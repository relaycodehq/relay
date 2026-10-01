import type { ChatMessage, ContextUsage } from "./projects";

/** The newest reported usage on this branch, unless a compaction reset it since. */
export function latestContext(
  messages: ChatMessage[],
): { usage: ContextUsage; provider: ChatMessage["provider"] } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    if (m.context) return { usage: m.context, provider: m.provider };
    if (m.compaction && m.status === "complete") return;
  }
}
