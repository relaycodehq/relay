import type { AgentActivity } from "../../../shared/projects";
import type { AcpToolCall } from "./protocol";

/** Tool kinds that change files. */
export const editKinds = new Set(["edit", "delete", "move"]);
/** Tool kinds that only look. */
export const lookKinds = new Set(["read", "search", "think", "fetch"]);

const kinds: Record<string, AgentActivity["kind"]> = {
  execute: "command",
  edit: "file",
  delete: "file",
  move: "file",
  read: "read",
  search: "search",
  fetch: "web",
};

const statuses: Record<string, AgentActivity["status"]> = {
  completed: "complete",
  failed: "failed",
};

const field = (raw: unknown, ...keys: string[]) => {
  if (typeof raw !== "object" || raw === null) return "";
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

/** What a call printed, out of its content blocks, or its raw output where it has none. */
function output(call: Partial<AcpToolCall>) {
  const texts = (call.content ?? []).flatMap((item) =>
    item.type === "content" && item.content?.text ? [item.content.text] : [],
  );
  if (texts.length) return texts.join("\n");
  const raw = call.rawOutput;
  if (typeof raw === "string") return raw;
  return field(raw, "output", "stdout", "error", "message");
}

/** Every file a call writes, from its diffs and, for edit kinds, its locations. */
export function acpEdits(call: Partial<AcpToolCall>): string[] {
  const paths = new Set<string>();
  for (const item of call.content ?? [])
    if (item.type === "diff" && item.path) paths.add(item.path);
  if (call.kind && editKinds.has(call.kind))
    for (const location of call.locations ?? []) paths.add(location.path);
  return [...paths];
}

/**
 * A call as the trace shows it. ACP sends a call's fields once and then only
 * what changed, so `call` is everything heard about it so far.
 */
export function acpActivity(call: Partial<AcpToolCall> & { toolCallId: string }): AgentActivity {
  const kind = kinds[call.kind ?? ""] ?? "tool";
  const command = field(call.rawInput, "command", "cmd");
  const path = call.locations?.[0]?.path ?? field(call.rawInput, "path", "file_path", "filePath");
  const label =
    (kind === "command" && command) ||
    (kind === "file" && path) ||
    (kind === "read" && path) ||
    call.title ||
    call.kind ||
    "Tool";
  const detail = kind === "read" ? "" : output(call);
  return {
    id: call.toolCallId.slice(0, 180),
    kind,
    status: statuses[call.status ?? ""] ?? "running",
    label: label.slice(0, 500),
    ...(detail ? { detail: detail.slice(-8000) } : {}),
  };
}

/** The agent's plan as a checklist. */
export const planText = (entries: { content: string; status?: string | null }[]) =>
  entries
    .map(
      (entry) =>
        `- [${entry.status === "completed" ? "x" : " "}] ${entry.content}${entry.status === "in_progress" ? " (working on it)" : ""}`,
    )
    .join("\n");
