import type { SessionMessageAssistantTool } from "@opencode/client";
import type { AgentActivity } from "../../../shared/projects";
import { acpActivity, acpEdits } from "../acp/activity";

const kinds: Record<string, string> = {
  bash: "execute",
  shell: "execute",
  read: "read",
  grep: "search",
  glob: "search",
  list: "search",
  webfetch: "fetch",
  websearch: "fetch",
  edit: "edit",
  write: "edit",
  apply_patch: "edit",
};

export function nativeCall(tool: SessionMessageAssistantTool): {
  activity: AgentActivity;
  edits: string[];
} {
  const state = tool.state;
  const input = state.status === "streaming" ? undefined : state.input;
  const metadata = "metadata" in state ? state.metadata : undefined;
  const path = [
    input?.filePath,
    input?.file_path,
    input?.path,
    metadata?.filepath,
  ].find((v) => typeof v === "string") as string | undefined;
  const call = {
    toolCallId: tool.id,
    title: tool.name,
    kind: kinds[tool.name] ?? "other",
    status:
      state.status === "completed"
        ? "completed"
        : state.status === "error"
          ? "failed"
          : "in_progress",
    rawInput: input,
    ...(path ? { locations: [{ path }] } : {}),
    rawOutput:
      "content" in state
        ? state.content
            ?.flatMap((c) => (c.type === "text" ? [c.text] : []))
            .join("\n")
        : "",
  };
  const activity = acpActivity(call);
  return {
    activity:
      tool.name === "subagent" || tool.name === "task"
        ? { ...activity, kind: "agent" }
        : activity,
    edits: acpEdits(call),
  };
}
