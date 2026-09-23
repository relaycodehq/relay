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
      label:
        paths.length > 1
          ? `${paths[0]} +${paths.length - 1} more`
          : (paths[0] ?? "Changed files"),
      detail: paths.join("\n"),
    };
  }
  if (
    (item.type === "mcpToolCall" || item.type === "dynamicToolCall") &&
    typeof item.tool === "string"
  )
    return { ...base, kind: "tool", label: item.tool.slice(0, 500) };
}

/** Name a Claude tool call by what it touched, not by the tool or its raw input. */
export function claudeActivity(
  id: string,
  name: string,
  value: unknown,
): AgentActivity {
  const input =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string).trim() : "";
  const call = (kind: AgentActivity["kind"], label: string) => ({
    id: id.slice(0, 180),
    status: "running" as const,
    kind,
    label: (label || name).slice(0, 500),
  });
  switch (name) {
    case "Bash":
      return call("command", text("command"));
    case "Read":
      return call("read", text("file_path"));
    case "Edit":
    case "MultiEdit":
    case "Write":
      return call("file", text("file_path"));
    case "NotebookEdit":
      return call("file", text("notebook_path"));
    case "Grep":
    case "Glob":
      return call(
        "search",
        [text("pattern"), text("path") && `in ${text("path")}`]
          .filter(Boolean)
          .join(" "),
      );
    case "WebSearch":
      return call("web", text("query"));
    case "WebFetch":
      return call("web", text("url"));
    case "Task":
    case "Agent":
      return call("agent", text("description"));
    case "TodoWrite":
      return call("tool", "Updated the plan");
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return call("tool", mcp ? `${mcp[1]}: ${mcp[2]}` : name);
}
