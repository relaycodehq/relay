import type { AgentActivity } from "../../../shared/projects";
import type { ToolPart } from "./events";

/** OpenCode's tools that write files, by the input field that names the file. */
const fileTools: Record<string, string> = {
  edit: "filePath",
  write: "filePath",
  multiedit: "filePath",
};

/** Name an OpenCode tool call by what it touched, not by the tool or its raw input. */
export function openCodeActivity(part: ToolPart): AgentActivity | undefined {
  const { state } = part;
  if (typeof part.callID !== "string" || typeof part.tool !== "string") return;
  const input = state.input ?? {};
  const text = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string).trim() : "";
  const status: AgentActivity["status"] =
    state.status === "error"
      ? "failed"
      : state.status === "completed"
        ? "complete"
        : "running";
  const call = (
    kind: AgentActivity["kind"],
    label: string,
    detail: string | undefined = state.error ?? undefined,
  ): AgentActivity => ({
    id: part.callID.slice(0, 180),
    status,
    kind,
    label: (label || state.title || part.tool).slice(0, 500),
    ...(detail ? { detail: detail.slice(-8000) } : {}),
  });
  const paths = editedPaths(part);
  if (paths.length)
    return call(
      "file",
      paths.length > 1 ? `${paths[0]} +${paths.length - 1} more` : paths[0],
      paths.length > 1 ? paths.join("\n") : undefined,
    );
  switch (part.tool) {
    case "bash": {
      const output =
        typeof state.metadata?.output === "string"
          ? state.metadata.output
          : state.output;
      return call(
        "command",
        text("command"),
        (output || state.error) ?? undefined,
      );
    }
    case "read":
      return call("read", text("filePath"));
    case "glob":
    case "grep":
    case "codesearch":
      return call(
        "search",
        [text("pattern") || text("query"), text("path") && `in ${text("path")}`]
          .filter(Boolean)
          .join(" "),
      );
    case "list":
      return call("search", text("path") || "Listed files");
    case "webfetch":
      return call("web", text("url"));
    case "websearch":
      return call("web", text("query"));
    case "task":
      return call("agent", text("description"));
    case "todowrite":
      return call("tool", "Updated the plan");
    case "todoread":
    case "question":
      return;
  }
  return call("tool", part.tool);
}

/** Every file an OpenCode tool call writes, as far as its input says. */
export function editedPaths(part: ToolPart): string[] {
  const input = part.state.input ?? {};
  const field = fileTools[part.tool];
  if (field)
    return typeof input[field] === "string" && input[field]
      ? [input[field] as string]
      : [];
  if (part.tool === "apply_patch" || part.tool === "patch") {
    const patch =
      typeof input.patchText === "string"
        ? input.patchText
        : typeof input.patch === "string"
          ? input.patch
          : "";
    return [
      ...patch.matchAll(
        /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm,
      ),
    ]
      .map((m) => (m[1] ?? m[2]).trim())
      .slice(0, 30);
  }
  return [];
}
