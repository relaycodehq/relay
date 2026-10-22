import { z } from "zod";
import type { ContextReport } from "../../../shared/context-report";
import type { ContextUsage } from "../../../shared/projects";
import type { CodexTransport } from "./codex-transport";

const pageSchema = z.object({
  data: z.array(
    z.object({
      turnId: z.string(),
      item: z.object({ id: z.string(), type: z.string() }).loose(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
type Item = z.infer<typeof pageSchema>["data"][number]["item"];

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const tokens = (value: string) => Math.ceil(value.trim().length / 4);

/** Text only: paths, image URLs, base64 and display metadata aren't prompt text. */
function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      const p = record(part);
      return p &&
        (p.type === "text" ||
          p.type === "inputText" ||
          p.type === "input_text" ||
          p.type === "output_text")
        ? [text(p.text)]
        : [];
    })
    .join("\n");
}

function toolText(item: Item): string {
  switch (item.type) {
    case "commandExecution":
      return [text(item.command), text(item.aggregatedOutput)].join("\n");
    case "functionCallOutput":
      return contentText(item.output);
    case "mcpToolCall":
      return [
        text(item.tool),
        JSON.stringify(item.arguments ?? {}),
        contentText(record(item.result)?.content),
        text(record(item.error)?.message),
      ].join("\n");
    case "dynamicToolCall":
      return [
        text(item.tool),
        JSON.stringify(item.arguments ?? {}),
        contentText(item.contentItems),
      ].join("\n");
    case "fileChange":
      return Array.isArray(item.changes)
        ? item.changes.map((c) => text(record(c)?.diff)).join("\n")
        : "";
    default:
      return "";
  }
}

/**
 * Visible history is not the prompt: tools may truncate output, compaction
 * hides its summary and instructions/tool schemas aren't all exposed. Count
 * only recent observable text and leave the rest explicitly unaccounted for.
 * Paging newest first also bounds work on long sessions and works with Codex's
 * paginated history, without hydrating a multi-megabyte thread/read response.
 */
export async function estimateCodexContext(
  wire: CodexTransport,
  threadId: string,
  usage: ContextUsage,
  instructions: unknown,
  model: string,
): Promise<ContextReport | null> {
  const used = usage.usedTokens;
  const max = usage.maxTokens;
  if (
    !Number.isFinite(used) ||
    used <= 0 ||
    !max ||
    !Number.isFinite(max) ||
    max <= 0
  )
    return null;
  const counts = new Map([
    ["Relay instructions", 0],
    ["Environment notes", 0],
    ["Messages", 0],
    ["Tool calls and results", 0],
  ]);
  const add = (name: string, value: string) => {
    const count = tokens(value);
    if (count) counts.set(name, (counts.get(name) ?? 0) + count);
  };
  add("Relay instructions", text(instructions));
  let cursor: string | undefined;
  const cursors = new Set<string>();
  const seen = new Set<string>();
  const deadline = Date.now() + 5_000;
  // At most 500 recent items; anything older belongs in the unknown remainder.
  pages: for (let page = 0; page < 20; page++) {
    if (page && Date.now() >= deadline) break;
    const result = await wire.call(
      "thread/items/list",
      {
        threadId,
        sortDirection: "desc",
        limit: 25,
        ...(cursor ? { cursor } : {}),
      },
      pageSchema,
    );
    for (const { turnId, item } of result.data) {
      if (item.type === "contextCompaction") break pages;
      const key = JSON.stringify([turnId, item.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.type === "userMessage")
        add("Messages", contentText(item.content));
      else if (item.type === "agentMessage") add("Messages", text(item.text));
      else if (item.type === "hookPrompt") {
        if (Array.isArray(item.fragments))
          add(
            "Environment notes",
            item.fragments.map((f) => text(record(f)?.text)).join("\n"),
          );
      } else add("Tool calls and results", toolText(item));
    }
    if (!result.nextCursor || cursors.has(result.nextCursor)) break;
    cursor = result.nextCursor;
    cursors.add(cursor);
  }
  const measured = [...counts.values()].reduce((sum, n) => sum + n, 0);
  // Visible output can be longer than the text actually kept in the prompt.
  const scale = measured > used ? used / measured : 1;
  const categories: ContextReport["categories"] = [...counts]
    .map(([name, count]) => ({
      name,
      tokens: Math.floor(count * scale),
      kind: "used" as const,
    }))
    .filter((c) => c.tokens > 0);
  const accounted = categories.reduce((sum, c) => sum + c.tokens, 0);
  if (used > accounted)
    categories.push({
      name: "Other / unaccounted",
      tokens: used - accounted,
      kind: "used",
    });
  if (max > used)
    categories.push({ name: "Free space", tokens: max - used, kind: "free" });
  return {
    estimated: true,
    model,
    totalTokens: used,
    maxTokens: max,
    categories,
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    skills: [],
  };
}
