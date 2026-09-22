import type { AgentActivity } from "../../shared/projects";

/** Keep a small, local-only activity trace. Never retain raw tool arguments or patches. */
export function codexActivity(
  method: string,
  value: unknown,
): AgentActivity | undefined {
  if (method !== "item/started" && method !== "item/completed") return;
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string") return;
  const status =
    item.status === "failed" ||
    item.status === "declined" ||
    item.success === false ||
    (typeof item.exitCode === "number" && item.exitCode !== 0)
      ? "failed"
      : method === "item/started"
        ? "running"
        : "complete";
  const base = { id: item.id.slice(0, 180), status } as const;
  if (item.type === "commandExecution" && typeof item.command === "string")
    return {
      ...base,
      kind: "command",
      label: item.command.slice(0, 500),
      ...(typeof item.aggregatedOutput === "string"
        ? { detail: item.aggregatedOutput.slice(-8000) }
        : {}),
    };
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    const paths = item.changes
      .flatMap((v) =>
        v && typeof v.path === "string" ? [v.path.slice(0, 500)] : [],
      )
      .slice(0, 30);
    return {
      ...base,
      kind: "file",
      label: `Changed ${paths.length} file${paths.length === 1 ? "" : "s"}`,
      detail: paths.join("\n"),
    };
  }
  if (
    (item.type === "mcpToolCall" || item.type === "dynamicToolCall") &&
    typeof item.tool === "string"
  )
    return { ...base, kind: "tool", label: item.tool.slice(0, 500) };
}
