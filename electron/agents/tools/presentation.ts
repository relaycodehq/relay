import { basename } from "node:path";
import type { AgentTool, AgentToolSource } from "../../../shared/agent-tools";
import type { AgentSkill } from "../skill-presentation";

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

export function sourceOf(scope: string | undefined): AgentToolSource {
  switch (scope?.toLowerCase()) {
    case "repo":
    case "repository":
    case "project":
    case "local":
    case "workspace":
      return "repo";
    case "user":
    case "personal":
      return "personal";
    case "plugin":
    case "plugins":
    case "app":
      return "plugins";
    case "system":
    case "builtin":
    case "built-in":
      return "builtin";
    case "managed":
    case "enterprise":
    case "enterprisemanaged":
      return "managed";
    default:
      return "other";
  }
}
export function skillItem(skill: AgentSkill): AgentTool {
  const plugin = /\/(?:\.codex|\.claude|\.agents)\/plugins\//.test(
    skill.path.replaceAll("\\", "/"),
  );
  return {
    id: skill.path,
    name: skill.name,
    description: skill.shortDescription || skill.description || "Agent skill",
    source: plugin ? "plugins" : sourceOf(skill.scope),
    state: skill.enabled ? "enabled" : "disabled",
    path: skill.path,
    detail: !skill.enabled
      ? "Disabled in the agent's configuration. It is excluded from the composer's skill picker."
      : skill.userInvocationOnly
        ? "Only you can start this skill; the agent cannot invoke it by itself."
        : skill.userInvocable === false
          ? "Only the agent can invoke this skill; it is not offered in the composer."
          : "Available to you and the agent.",
  };
}

/** Explicit allowlist: URL paths, query strings, arguments, env and headers never leave the main process. */
export function serverItem(
  name: string,
  raw: unknown,
  source: AgentToolSource,
  path?: string,
): AgentTool {
  const config = record(raw);
  let state: AgentTool["state"] =
    config.enabled === false || config.disabled === true
      ? "disabled"
      : "enabled";
  let summary: string | undefined;
  let transport: string | undefined;
  if (typeof config.url === "string") {
    transport =
      config.type === "sse"
        ? "SSE"
        : config.type === "ws"
          ? "WebSocket"
          : "HTTP";
    try {
      const url = new URL(config.url);
      if (url.protocol === "https:" || url.protocol === "http:")
        summary = url.origin;
      else if (state !== "disabled") state = "unknown";
    } catch {
      if (state !== "disabled") state = "unknown";
    }
  } else if (typeof config.command === "string") {
    transport = "stdio";
    // A command may be an entire shell expression. Show only a simple executable name.
    const command = basename(config.command.replaceAll("\\", "/"));
    if (/^[\w.-]+$/.test(command)) summary = command;
  }
  if (!transport && state !== "disabled") state = "unknown";
  return {
    id: name,
    name,
    source,
    state,
    ...(path ? { path } : {}),
    description: transport ? `${transport} MCP server` : "MCP server",
    ...(transport ? { transport } : {}),
    ...(summary ? { summary } : {}),
    detail:
      "Configuration only; connection health and credentials have not been checked. Arguments, URL paths, environment values and headers are hidden.",
  };
}
