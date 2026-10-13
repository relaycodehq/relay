import type { AgentActivity } from "../../../shared/projects";
import { isImagePath } from "../../../shared/answer-images";
import { mcpCall, patchPaths } from "../activity";
import type { MuseItem } from "./protocol";

/** Item kinds that are Muse's own bookkeeping, not something the agent did. */
const hidden = new Set(["userMessage", "agentMessage", "reasoning", "reminderChild", "hookRun", "sideChat"]);

const statusOf = (item: MuseItem): AgentActivity["status"] => {
  switch (item.status) {
    case "inProgress":
      return "running";
    case "completed":
      return "complete";
    case "cancelled":
      return "stopped";
    default:
      // failed, rejected, and whatever a newer Muse adds.
      return "failed";
  }
};

/** A tool call's arguments: Muse hands the model's JSON over verbatim, so it may not parse. */
export function argsOf(item: MuseItem): Record<string, unknown> {
  if (!item.args) return {};
  try {
    const parsed = JSON.parse(item.args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const text = (args: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string")
      return value.filter((v) => typeof v === "string").join(" ");
  }
  return "";
};

const pathKeys = ["path", "file_path", "filePath", "file", "target", "filename"];

/** What kind of call a tool's name says it is; Muse names its tools in snake_case. */
function kindOf(tool: string): AgentActivity["kind"] {
  if (/^(mcp__|.+__)/.test(tool)) return "tool";
  if (/shell|bash|exec|command|terminal|run_/.test(tool)) return "command";
  if (/write|edit|patch|create_file|replace|delete_file|move_file|rename/.test(tool)) return "file";
  if (/read|view|open_file|cat|list_dir|ls/.test(tool)) return "read";
  if (/grep|glob|search|find/.test(tool)) return tool.startsWith("web") ? "web" : "search";
  if (/web|fetch|url|browse/.test(tool)) return "web";
  if (/agent|task|delegate/.test(tool)) return "agent";
  return "tool";
}

/** An MCP tool as Muse names it: `mcp__server__tool` or `server__tool`. */
const mcpOf = (tool: string) => /^(?:mcp__)?([^_].*?)__(.+)$/.exec(tool);

/** Name a Muse transcript item by what it did, as Relay's trace rows show calls. */
export function museActivity(item: MuseItem, parentId?: string): AgentActivity | undefined {
  if (hidden.has(item.kind)) return;
  const status = statusOf(item);
  const base = {
    id: item.itemId.slice(0, 180),
    status,
    ...(parentId && { parentId }),
  };
  const output = item.visibleOutput || item.failureReason;
  const detail = output ? { detail: output.slice(-8000) } : {};
  switch (item.kind) {
    case "subagent":
      return {
        ...base,
        kind: "agent",
        label: (item.objective || item.role || "Subagent").slice(0, 500),
        ...(item.statusLine && status === "running" && { progress: item.statusLine.slice(0, 200) }),
        ...((item.result?.summary || item.failureReason) && {
          detail: (item.result?.summary || item.failureReason)!.slice(0, 8000),
        }),
      };
    case "workflow":
      return {
        ...base,
        kind: "agent",
        label: (item.fallbackText || "Workflow").slice(0, 500),
        ...detail,
      };
    case "compaction":
      return {
        ...base,
        kind: "tool",
        label: status === "running" ? "Compacting the conversation" : "Compacted the conversation",
        ...(item.reason && status !== "complete" && { detail: item.reason }),
      };
    case "webSearch":
      return {
        ...base,
        kind: "web",
        label: (text(argsOf(item), "query", "q") || item.fallbackText || "Searched the web").slice(0, 500),
        ...detail,
      };
    case "userShell":
      return { ...base, kind: "command", label: (item.text || "Shell").slice(0, 500), ...detail };
    case "toolCall":
      break;
    default:
      // A kind this Relay doesn't know: Muse's one-line summary of it.
      return item.fallbackText
        ? { ...base, kind: "tool", label: item.fallbackText.slice(0, 500), ...detail }
        : undefined;
  }
  const tool = item.tool ?? "tool";
  const args = argsOf(item);
  const mcp = mcpOf(tool);
  if (mcp) return { ...base, kind: "tool", ...mcpCall(mcp[1]!, mcp[2]!), ...detail };
  const kind = kindOf(tool);
  const label = (() => {
    switch (kind) {
      case "command":
        return text(args, "command", "cmd", "script", "argv");
      case "file": {
        const paths = museEditedPaths(item);
        return paths.length > 1 ? `${paths[0]} +${paths.length - 1} more` : paths[0];
      }
      case "read":
        return text(args, ...pathKeys, "paths");
      case "search":
        return [text(args, "pattern", "query", "regex", "glob"), text(args, "path", "dir") && `in ${text(args, "path", "dir")}`]
          .filter(Boolean)
          .join(" ");
      case "web":
        return text(args, "url", "query");
      case "agent":
        return text(args, "description", "objective", "prompt", "task");
    }
  })();
  const path = text(args, ...pathKeys);
  return {
    ...base,
    kind,
    label: (label || item.statusLine || tool).slice(0, 500),
    // A file's change: how much it changed, as Muse summed it up.
    ...(kind === "file" && item.patchSummary
      ? {
          detail: `+${item.patchSummary.added} −${item.patchSummary.removed}${item.patchSummary.files > 1 ? ` in ${item.patchSummary.files} files` : ""}`,
        }
      : detail),
    ...(kind === "read" && status === "complete" && path && isImagePath(path) && { image: path }),
  };
}

/** The files a Muse tool call writes, as its arguments name them. */
export function museEditedPaths(item: MuseItem): string[] {
  if (item.kind !== "toolCall" || !item.tool || kindOf(item.tool) !== "file") return [];
  const args = argsOf(item);
  const patch = text(args, "patch", "input", "diff");
  if (patch.includes("*** ")) return patchPaths(patch);
  const many = args.paths ?? args.files;
  if (Array.isArray(many))
    return many
      .map((p) => (typeof p === "string" ? p : (p as { path?: unknown })?.path))
      .filter((p): p is string => typeof p === "string" && !!p)
      .slice(0, 30);
  const one = text(args, ...pathKeys);
  return one ? [one] : [];
}

/** Muse's todo list in the shape Codex's plan rows read; the statuses are the same words. */
export const todoPlan = (items: { text: string; status: string }[]) => ({
  plan: items.map((todo) => ({ step: todo.text, status: todo.status })),
});
