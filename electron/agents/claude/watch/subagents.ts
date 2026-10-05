import type { AgentWatch } from "../../types";
import type { SubagentRun } from "../../watch/prompt";
import { SubagentLog } from "./digest";

/** The frames this reads, loosely: it only looks for what it needs. */
type Frame = {
  type: string;
  subtype?: string;
  parent_tool_use_id?: string | null;
  message?: { content?: unknown };
  task_id?: string;
  tool_use_id?: string;
  task_type?: string;
  is_backgrounded?: boolean;
  status?: string;
  patch?: { status?: string; is_backgrounded?: boolean };
};
type Block = {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

type Run = {
  log: SubagentLog;
  background?: boolean;
};

/**
 * Follows the subagents a session's turns start, for as long as the session
 * lives: Claude runs most in the background, so their work goes on after the
 * turn that started them ended. One that changed files waits, once it ends,
 * for the look back at the end of the next watched turn.
 */
export class SubagentWatch {
  private runs = new Map<string, Run>();
  private tasks = new Map<string, string>();
  private ended = new Set<Run>();

  /** Subagents that changed files and finished since the last look; each is handed over once. */
  take(): SubagentRun[] {
    const runs = [...this.ended].filter((run) => run.log.edited);
    this.ended.clear();
    return runs.map((run) => ({
      task: run.log.label,
      digest: run.log.digest(),
    }));
  }

  /**
   * One frame of the session; `turn` is the running turn's watch, if any.
   * Replayed frames from before a restart must not come here.
   */
  observe(message: unknown, turn: { watch?: AgentWatch; signal: AbortSignal }) {
    const frame = message as Frame;
    const content = Array.isArray(frame.message?.content)
      ? (frame.message.content as Block[])
      : [];
    const parent = frame.parent_tool_use_id ?? null;
    if (frame.type === "assistant") {
      for (const block of content)
        if (block.type === "tool_use" && isAgentCall(block.name))
          this.start(block, turn);
      const run = parent ? this.runs.get(parent) : undefined;
      if (!run) return;
      const text = content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");
      if (text) run.log.said(text);
      for (const block of content)
        if (block.type === "tool_use" && block.name)
          run.log.called(block.name, block.input);
    } else if (frame.type === "user") {
      for (const block of content) {
        if (block.type !== "tool_result" || !block.tool_use_id) continue;
        if (parent && block.is_error)
          this.runs.get(parent)?.log.failed(textOf(block.content));
        // A foreground agent's result is its report; a background one's is a placeholder.
        const run = parent ? undefined : this.runs.get(block.tool_use_id);
        if (run && run.background === false) this.finish(run);
      }
    } else if (frame.type === "system") this.task(frame);
  }

  private start(block: Block, turn: { watch?: AgentWatch }) {
    if (!block.id || this.runs.has(block.id)) return;
    if (turn.watch?.scope !== "subagents") return;
    const input = (block.input ?? {}) as {
      description?: unknown;
      prompt?: unknown;
    };
    this.runs.set(block.id, {
      log: new SubagentLog(
        block.id,
        (typeof input.description === "string" && input.description) ||
          "Subagent",
        typeof input.prompt === "string" ? input.prompt : "",
      ),
    });
  }

  private task(frame: Frame) {
    const id = frame.tool_use_id ?? this.tasks.get(frame.task_id ?? "");
    const run = id ? this.runs.get(id) : undefined;
    if (!run) return;
    if (frame.subtype === "task_started") {
      if (frame.task_id) this.tasks.set(frame.task_id, id!);
      if (frame.is_backgrounded !== undefined)
        run.background = frame.is_backgrounded;
    } else if (frame.subtype === "task_updated") {
      if (frame.patch?.is_backgrounded !== undefined)
        run.background = frame.patch.is_backgrounded;
      if (["completed", "failed", "killed"].includes(frame.patch?.status ?? ""))
        this.finish(run);
    } else if (frame.subtype === "task_notification") this.finish(run);
  }

  private finish(run: Run) {
    if (run.log.fresh) this.ended.add(run);
  }
}

const isAgentCall = (name?: string) => name === "Agent" || name === "Task";

/** A tool result's text, whether it came as a string or as blocks. */
function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: Block) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("\n");
}
