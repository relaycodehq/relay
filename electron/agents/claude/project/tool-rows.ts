import type {
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentActivity } from "../../../../shared/projects";
import { claudeActivity, claudeEditedPaths } from "../../activity";
import type { ClaudeRunOptions } from "./config";
import { ForkParents, type ForkStart } from "../forks";

type Results = Exclude<SDKUserMessage["message"]["content"], string>;

/** The rows a turn's tool calls show as, from the call to its result. */
export class ToolRows {
  // A tool result only carries the call id; keep the call's label for the finished row.
  private calls = new Map<string, AgentActivity>();
  // A subagent's latest summary, by its call; reports between them omit it.
  private summaries = new Map<string, string>();
  private forks = new ForkParents();
  /** Forked skills' rows, by their task. */
  private forkRows = new Map<string, string>();

  constructor(private options: ClaudeRunOptions) {}

  /** A forked skill gets the row an Agent call would have; its calls fold under it. */
  fork(message: ForkStart) {
    const id = this.forks.start(message);
    this.forkRows.set(message.task_id, id);
    this.call(
      { id, name: "Agent", input: { description: message.description } },
      null,
    );
  }

  /** The parent a subagent's frame means, a forked skill's made-up one included. */
  parentOf(parent: string | null) {
    return this.forks.resolve(parent);
  }

  isFork(parent: string | null) {
    return [...this.forkRows.values()].includes(this.parentOf(parent) ?? "");
  }

  /** A forked skill ended; no Agent result will come to finish its row. */
  ended(message: SDKTaskNotificationMessage) {
    const call = this.calls.get(this.forkRows.get(message.task_id) ?? "");
    if (call?.status !== "running") return;
    const finished: AgentActivity = {
      ...call,
      progress: undefined,
      status: message.status === "completed" ? "complete" : "failed",
    };
    this.calls.set(finished.id, finished);
    this.options.onActivity?.(finished);
  }

  /** A call Claude made, or the subagent started by call `parent`. */
  call(
    tool: { id: string; name: string; input: unknown },
    parent: string | null,
  ) {
    const activity = claudeActivity(tool.id, tool.name, tool.input);
    parent = this.parentOf(parent);
    // A subagent's calls fold under the agent call that started it.
    if (parent) activity.parentId = parent.slice(0, 180);
    this.calls.set(tool.id, activity);
    this.options.onActivity?.(activity);
    const edited = claudeEditedPaths(tool.name, tool.input);
    if (edited.length) this.options.onEdit?.(edited);
  }

  results(content: Results, parent: string | null) {
    parent = this.parentOf(parent);
    for (const result of content)
      if (result.type === "tool_result") {
        const call = this.calls.get(result.tool_use_id);
        const output =
          typeof result.content === "string"
            ? result.content
            : Array.isArray(result.content)
              ? result.content
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n")
              : "";
        const finished: AgentActivity = {
          ...(call ?? claudeActivity(result.tool_use_id, "Tool", {})),
          progress: undefined,
          ...(!call && parent ? { parentId: parent.slice(0, 180) } : {}),
          status: result.is_error ? "failed" : "complete",
          ...(output ? { detail: output.slice(-8000) } : {}),
        };
        this.calls.set(result.tool_use_id, finished);
        this.options.onActivity?.(finished);
      }
  }

  /** A running subagent's row says what it is doing now. */
  progress(message: SDKTaskProgressMessage) {
    const call = this.calls.get(
      message.tool_use_id ?? this.forkRows.get(message.task_id) ?? "",
    );
    if (call?.kind !== "agent" || call.status !== "running") return;
    const summary = message.summary?.trim();
    if (summary) this.summaries.set(call.id, summary);
    const doing =
      this.summaries.get(call.id) ||
      (message.last_tool_name && `Using ${message.last_tool_name}`);
    const uses = message.usage.tool_uses;
    const progress = [doing, uses && `${uses} tool${uses === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300);
    if (progress && progress !== call.progress) {
      const updated = { ...call, progress };
      this.calls.set(updated.id, updated);
      this.options.onActivity?.(updated);
    }
  }
}
