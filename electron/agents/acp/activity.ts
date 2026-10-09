import type { AgentActivity } from "../../../shared/projects";
import { patchPaths } from "../activity";
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

/**
 * Shell tools an adapter left as kind "other". Amp on a GPT model calls the
 * Codex tools, and amp-acp only knows Claude's names.
 */
const shellTools = new Set(["shell_command", "shell", "exec_command", "local_shell", "bash"]);

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

/**
 * What a call printed, out of its content blocks, or its raw output where it
 * has none. Some adapters pass a shell result on as its JSON, {output, exitCode}.
 */
function output(call: Partial<AcpToolCall>): { text: string; exitCode?: number } {
  const texts = (call.content ?? []).flatMap((item) =>
    item.type === "content" && item.content?.text ? [item.content.text] : [],
  );
  const raw = texts.length ? texts.join("\n") : call.rawOutput;
  if (typeof raw !== "string") return { text: field(raw, "output", "stdout", "error", "message") };
  if (!raw.trimStart().startsWith("{")) return { text: raw };
  try {
    const result = JSON.parse(raw) as { output?: unknown; exitCode?: unknown } | null;
    const { output: text, exitCode } = result ?? {};
    if (typeof text === "string")
      return { text, ...(typeof exitCode === "number" ? { exitCode } : {}) };
  } catch {}
  return { text: raw };
}

const patchOf = (call: Partial<AcpToolCall>) => field(call.rawInput, "patchText", "patch", "input");

/** Every file a call writes, from its diffs and, for edit kinds, its locations. */
export function acpEdits(call: Partial<AcpToolCall>): string[] {
  const paths = new Set<string>();
  for (const item of call.content ?? [])
    if (item.type === "diff" && item.path) paths.add(item.path);
  if (call.kind && editKinds.has(call.kind))
    for (const location of call.locations ?? []) paths.add(location.path);
  for (const path of patchPaths(patchOf(call))) paths.add(path);
  return [...paths];
}

/**
 * A call as the trace shows it. ACP sends a call's fields once and then only
 * what changed, so `call` is everything heard about it so far.
 */
export function acpActivity(call: Partial<AcpToolCall> & { toolCallId: string }): AgentActivity {
  const command = field(call.rawInput, "command", "cmd");
  const tool = /^([\w.-]+)(?::|$)/.exec(call.title ?? "")?.[1]?.toLowerCase() ?? "";
  const patched = patchPaths(patchOf(call));
  const kind =
    kinds[call.kind ?? ""] ??
    (patched.length ? "file" : command && shellTools.has(tool) ? "command" : "tool");
  const path =
    call.locations?.[0]?.path ??
    (field(call.rawInput, "path", "file_path", "filePath") ||
      (patched.length > 1 ? `${patched[0]} +${patched.length - 1} more` : patched[0]));
  const label =
    (kind === "command" && command) ||
    (kind === "file" && path) ||
    (kind === "read" && path) ||
    call.title ||
    call.kind ||
    "Tool";
  const printed = output(call);
  const detail = kind === "read" ? "" : printed.text;
  const status = statuses[call.status ?? ""] ?? "running";
  return {
    id: call.toolCallId.slice(0, 180),
    kind,
    status: status === "complete" && printed.exitCode ? "failed" : status,
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
