import type { AgentActivity } from "../../../shared/projects";
import { mcpCall } from "../activity";

/** Where the SDK serves custom tools from: Relay's tools (relay-tools.ts) and a reviewer's read-only git (git-tool.ts). */
const CUSTOM_TOOLS_SERVER = "custom-user-tools";

/** A tool call as the worker forwards it: the SDK's, cut down (see `slim` in worker.ts). */
export interface CursorCall {
  type: string;
  args?: Record<string, unknown>;
  result?: {
    status?: string;
    exitCode?: number;
    output?: string;
    error?: string;
  };
}

const text = (call: CursorCall, key: string) =>
  typeof call.args?.[key] === "string" ? (call.args[key] as string).trim() : "";

/** Every file a Cursor tool call writes. */
export function cursorEdits(call: CursorCall): string[] {
  if (call.type !== "write" && call.type !== "edit" && call.type !== "delete")
    return [];
  const path = text(call, "path");
  return path ? [path] : [];
}

/** The plan Cursor wrote, when this call is the one that writes it. */
export function cursorPlan(call: CursorCall): string | undefined {
  return call.type === "createPlan"
    ? text(call, "plan") || undefined
    : undefined;
}

/** Name a tool call by what it touched, not by the tool or its raw arguments. */
export function cursorActivity(
  callId: string,
  call: CursorCall,
  done: boolean,
): AgentActivity | undefined {
  const status: AgentActivity["status"] = !done
    ? "running"
    : call.result?.status === "error"
      ? "failed"
      : "complete";
  const make = (
    kind: AgentActivity["kind"],
    label: string,
    detail?: string,
  ): AgentActivity => ({
    id: callId.slice(0, 180),
    status,
    kind,
    label: (label || call.type).slice(0, 500),
    ...(detail ? { detail: detail.slice(-8000) } : {}),
  });
  switch (call.type) {
    case "shell":
      return make(
        "command",
        text(call, "command"),
        call.result?.output || call.result?.error,
      );
    case "write":
    case "edit":
    case "delete":
      return make("file", text(call, "path"), call.result?.error);
    case "read":
      return make("read", text(call, "path"));
    case "grep":
      return make(
        "search",
        [
          text(call, "pattern"),
          text(call, "path") && `in ${text(call, "path")}`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    case "glob":
      return make("search", text(call, "globPattern"));
    case "ls":
      return make("search", text(call, "path") || "Listed files");
    case "semSearch":
      return make("search", text(call, "query"));
    case "task":
      return make("agent", text(call, "description"));
    case "mcp": {
      const server = text(call, "providerIdentifier");
      const tool = text(call, "toolName");
      if (!tool || !server) return make("tool", tool || server);
      const git = call.args?.gitArgs;
      if (server === CUSTOM_TOOLS_SERVER && Array.isArray(git))
        return make("command", ["git", ...git].join(" "));
      return {
        ...make("tool", tool),
        ...mcpCall(server === CUSTOM_TOOLS_SERVER ? "relay" : server, tool),
      };
    }
    case "updateTodos":
      return make("tool", "Updated the plan");
    case "readLints":
      return make("tool", "Checked lints");
    // Shown as the plan, not as a call.
    case "createPlan":
      return undefined;
  }
  return make("tool", call.type);
}
