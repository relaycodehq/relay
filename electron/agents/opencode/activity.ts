import type { AgentActivity } from "../../../shared/projects";
import { mcpCall, patchPaths } from "../activity";
import type { ToolPart } from "./events";

/** OpenCode's tools that write files, by the input field that names the file. */
const fileTools: Record<string, string> = {
  edit: "filePath",
  write: "filePath",
  multiedit: "filePath",
};

const DETAIL_LIMIT = 8000;
/** A file, a listing or a page reads from its top; a run, an edit or an agent's report from its end. */
const fromStart = new Set<AgentActivity["kind"]>(["read", "search", "web"]);

/** An MCP tool as OpenCode names it, `<server>_<tool>`, split back apart. */
export type McpTool = (
  name: string,
) => { server: string; tool: string } | undefined;

/**
 * Name an OpenCode tool call by what it touched, not by the tool or its raw
 * input. A finished call keeps what it returned, a failed one its error.
 */
export function openCodeActivity(
  part: ToolPart,
  mcpTool?: McpTool,
): AgentActivity | undefined {
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
  const result =
    status === "failed"
      ? state.error
      : status === "complete"
        ? state.output
        : undefined;
  const call = (
    kind: AgentActivity["kind"],
    label: string,
    detail: string | null | undefined = result,
  ): AgentActivity => ({
    id: part.callID.slice(0, 180),
    status,
    kind,
    label: (label || state.title || part.tool).slice(0, 500),
    ...(detail?.trim()
      ? {
          detail:
            fromStart.has(kind) && status !== "failed"
              ? detail.slice(0, DETAIL_LIMIT)
              : detail.slice(-DETAIL_LIMIT),
        }
      : {}),
  });
  const paths = editedPaths(part);
  if (paths.length)
    return call(
      "file",
      paths.length > 1 ? `${paths[0]} +${paths.length - 1} more` : paths[0],
      paths.length > 1 ? paths.join("\n") : result,
    );
  switch (part.tool) {
    case "bash": {
      // While it runs, only the metadata has its output so far.
      const output =
        typeof state.metadata?.output === "string"
          ? state.metadata.output
          : state.output;
      return call("command", text("command"), output || state.error);
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
      // Its output is the plan again, which the row's label already says.
      return call("tool", "Updated the plan", state.error);
    case "todoread":
    case "question":
      return;
  }
  const mcp = mcpTool?.(part.tool);
  return mcp
    ? { ...call("tool", part.tool), ...mcpCall(mcp.server, mcp.tool) }
    : call("tool", part.tool);
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
    return patchPaths(patch);
  }
  return [];
}
