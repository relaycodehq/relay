// Follows the subagents a Claude session starts, for as long as it lives: the
// brief Claude wrote, the text and calls each makes, and whether it's still
// going. Agents run in the background by default and outlive the turn that
// started them, so the session feeds this every frame, between turns too.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTrace } from "../../shared/projects";
import type {
  SubagentDetail,
  SubagentRun,
  SubagentStatus,
} from "../../shared/subagents";
import { claudeActivity } from "./activity";

/**
 * How sure an ending is. The task's own word beats the Agent call's result,
 * which beats the task merely dropping out of the live set.
 */
const certainty = { level: 0, result: 1, task: 2 };
type Source = keyof typeof certainty;

type Run = {
  id: string;
  taskId?: string;
  description: string;
  type?: string;
  model?: string;
  brief?: string;
  status: SubagentStatus;
  endedBy?: Source;
  started: number;
  ended?: number;
  summary?: string;
  /** Tool calls the SDK counted, in case some never came through. */
  toolUses: number;
  background?: boolean;
  /** Seen in the SDK's live set, so leaving it means it ended. */
  listed?: boolean;
  parentId?: string;
  trace: AgentTrace[];
  /** Its latest text with no call after it: its answer, once it has ended. */
  answer?: { id: string; text: string };
  /** What the SDK said it returned, for when none of its text came through. */
  returned?: string;
};
type Call = Extract<AgentTrace, { kind: "activity" }>;
type Block = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
};

const limits = {
  runs: 40,
  trace: 400,
  text: 20_000,
  detail: 4_000,
  brief: 8_000,
};

const textOf = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .flatMap((part: Block) =>
            part?.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join("\n")
      : "";

export class SubagentTracker {
  private runs = new Map<string, Run>();
  /** Agent call ids by SDK task id. */
  private tasks = new Map<string, string>();
  /** The SDK's live background tasks; it usually lists one before saying it started. */
  private live = new Set<string>();
  constructor(private now = () => Date.now()) {}

  observe(message: SDKMessage) {
    if (message.type === "assistant")
      this.assistant(
        message.parent_tool_use_id,
        message.message.id,
        message.message.content as Block[],
      );
    else if (message.type === "user") this.user(message);
    else if (message.type === "system") this.system(message);
  }

  /** The session ended, and its agents with it. */
  close() {
    for (const run of this.runs.values())
      if (run.status === "running") this.end(run, "stopped", "task");
  }

  list(): SubagentRun[] {
    return [...this.runs.values()].map((run) => this.view(run));
  }

  detail(id: string): SubagentDetail | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    const done = run.status !== "running";
    const answer = done ? run.answer : undefined;
    const report = done ? (answer?.text ?? run.returned) : undefined;
    return {
      ...this.view(run),
      trace: this.settled(run).filter((e) => e.id !== answer?.id),
      ...(report ? { report } : {}),
    };
  }

  /** The SDK task to stop, while the agent runs. */
  taskId(id: string) {
    const run = this.runs.get(id);
    return run?.status === "running" ? run.taskId : undefined;
  }

  private view(run: Run): SubagentRun {
    const calls = this.settled(run).flatMap((e) =>
      e.kind === "activity" ? [e.activity] : [],
    );
    const report =
      run.status === "running" ? undefined : (run.answer?.text ?? run.returned);
    return {
      id: run.id,
      description: run.description,
      type: run.type,
      model: run.model,
      brief: run.brief,
      status: run.status,
      started: run.started,
      ended: run.ended,
      summary: run.summary,
      calls: Math.max(calls.length, run.toolUses),
      // The card lists them; their output stays in the side thread.
      recent: calls.slice(-5).map(({ detail, ...call }) => call),
      outcome: report?.replace(/\s+/g, " ").slice(0, 240),
      parentId: run.parentId,
    };
  }

  private assistant(parent: string | null, messageId: string, blocks: Block[]) {
    const owner = parent ? this.runs.get(parent) : undefined;
    const calls = blocks.filter(
      (b): b is Block & { id: string; name: string } =>
        b.type === "tool_use" && !!b.id && !!b.name,
    );
    for (const call of calls)
      if (call.name === "Agent" || call.name === "Task")
        this.launch(call.id, call.input, parent ?? undefined);
    if (!owner) return;
    // What it says comes before the calls it makes, as in the main turn.
    const text = blocks
      .flatMap((b) => (b.type === "text" && b.text ? [b.text] : []))
      .join("\n")
      .trim()
      .slice(0, limits.text);
    const id = `text:${messageId}`;
    if (text) this.put(owner, { kind: "commentary", id, text });
    for (const call of calls)
      this.put(owner, {
        kind: "activity",
        id: call.id,
        activity: claudeActivity(call.id, call.name, call.input),
      });
    // Its last word with no call after it is what it hands back.
    if (calls.length) owner.answer = undefined;
    else if (text) owner.answer = { id, text };
  }

  private user(message: Extract<SDKMessage, { type: "user" }>) {
    const content = message.message.content;
    if (!Array.isArray(content)) return;
    const parent = message.parent_tool_use_id;
    const owner = parent ? this.runs.get(parent) : undefined;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const failed = block.is_error === true;
      const output = textOf(block.content);
      if (owner) this.finishCall(owner, block.tool_use_id, failed, output);
      const run = this.runs.get(block.tool_use_id);
      if (run) this.returned(run, failed, output, message.tool_use_result);
    }
  }

  private system(message: Extract<SDKMessage, { type: "system" }>) {
    switch (message.subtype) {
      case "task_started": {
        if (message.ambient || message.skip_transcript) return;
        if (message.task_type && message.task_type !== "local_agent") return;
        if (!message.tool_use_id) return;
        const run = this.launch(message.tool_use_id, {
          description: message.description,
          subagent_type: message.subagent_type,
          prompt: message.prompt,
        });
        run.taskId = message.task_id;
        this.tasks.set(message.task_id, run.id);
        if (this.live.has(message.task_id)) run.listed = true;
        if (message.is_backgrounded !== undefined)
          run.background = message.is_backgrounded;
        run.type ??= message.subagent_type;
        if (!run.brief && message.prompt)
          run.brief = message.prompt.slice(0, limits.brief);
        return;
      }
      case "task_progress": {
        const run = this.find(message.task_id, message.tool_use_id);
        if (run?.status !== "running") return;
        // Only some reports carry a summary; the rest keep the last one.
        const summary = message.summary?.trim();
        if (summary) run.summary = summary.slice(0, 300);
        run.toolUses = Math.max(run.toolUses, message.usage.tool_uses);
        return;
      }
      case "task_updated": {
        const run = this.find(message.task_id);
        if (!run) return;
        const { status, is_backgrounded } = message.patch;
        if (is_backgrounded !== undefined) run.background = is_backgrounded;
        if (status === "completed" || status === "failed")
          this.end(run, status, "task");
        else if (status === "killed") this.end(run, "stopped", "task");
        return;
      }
      case "task_notification": {
        const run = this.find(message.task_id, message.tool_use_id);
        if (!run) return;
        // A stopped agent's summary only says it stopped; it reported nothing.
        const summary = message.summary?.trim();
        if (summary && !run.returned && message.status !== "stopped")
          run.returned = summary.slice(0, limits.text);
        this.end(run, message.status, "task");
        return;
      }
      case "background_tasks_changed": {
        // The live set is the truth, so a missed ending can't leave one
        // running. It often lands before the task's own word on how it ended.
        this.live = new Set(message.tasks.map((t) => t.task_id));
        for (const run of this.runs.values()) {
          if (!run.taskId) continue;
          if (this.live.has(run.taskId)) run.listed = true;
          else if (run.listed) this.end(run, "completed", "level");
        }
        return;
      }
    }
  }

  private launch(id: string, input: unknown, parentId?: string) {
    const known = this.runs.get(id);
    if (known) return known;
    const field = (key: string) => {
      const value = (input as Record<string, unknown> | undefined)?.[key];
      return typeof value === "string" ? value.trim() : "";
    };
    const run: Run = {
      id,
      description: field("description").slice(0, 300) || "Agent",
      type: field("subagent_type") || undefined,
      model: field("model") || undefined,
      brief: field("prompt").slice(0, limits.brief) || undefined,
      status: "running",
      started: this.now(),
      toolUses: 0,
      parentId,
      trace: [],
    };
    this.runs.set(id, run);
    if (this.runs.size > limits.runs) {
      // The oldest finished one goes; running ones stay however many there are.
      const old = [...this.runs.values()].find((r) => r.status !== "running");
      if (old) {
        this.runs.delete(old.id);
        if (old.taskId) this.tasks.delete(old.taskId);
      }
    }
    return run;
  }

  private find(taskId: string, toolUseId?: string) {
    return (
      this.runs.get(toolUseId ?? "") ??
      this.runs.get(this.tasks.get(taskId) ?? "")
    );
  }

  private put(run: Run, entry: AgentTrace) {
    const at = run.trace.findIndex((e) => e.id === entry.id);
    if (at >= 0) run.trace[at] = entry;
    else run.trace.push(entry);
    if (run.trace.length > limits.trace)
      run.trace.splice(0, run.trace.length - limits.trace);
  }

  private finishCall(run: Run, id: string, failed: boolean, output: string) {
    const entry = run.trace.find(
      (e): e is Call => e.kind === "activity" && e.id === id,
    );
    if (!entry) return;
    this.put(run, {
      ...entry,
      activity: {
        ...entry.activity,
        status: failed ? "failed" : "complete",
        ...(output ? { detail: output.slice(-limits.detail) } : {}),
      },
    });
  }

  /** The Agent call returned: its answer, or word that it went to the background. */
  private returned(run: Run, failed: boolean, output: string, result: unknown) {
    const out = (result && typeof result === "object" ? result : {}) as {
      status?: unknown;
      resolvedModel?: unknown;
      prompt?: unknown;
      content?: unknown;
    };
    if (typeof out.resolvedModel === "string") run.model = out.resolvedModel;
    if (!run.brief && typeof out.prompt === "string")
      run.brief = out.prompt.slice(0, limits.brief);
    if (
      out.status === "async_launched" ||
      output.startsWith("Async agent launched")
    ) {
      run.background = true;
      return;
    }
    // The structured answer leaves out the ids and usage the model reads after it.
    const answer = (textOf(out.content) || output).trim();
    if (answer) run.returned = answer.slice(0, limits.text);
    this.end(run, failed ? "failed" : "completed", "result");
  }

  private end(run: Run, status: SubagentStatus, source: Source) {
    if (
      run.status !== "running" &&
      certainty[source] <= certainty[run.endedBy ?? "task"]
    )
      return;
    run.status = status;
    run.endedBy = source;
    run.ended ??= this.now();
    run.summary = undefined;
  }

  /** Its trace as it reads now: calls it left open ended with it, however that turns out. */
  private settled(run: Run): AgentTrace[] {
    if (run.status === "running") return run.trace;
    const status = run.status === "completed" ? "complete" : "failed";
    return run.trace.map((e) =>
      e.kind === "activity" && e.activity.status === "running"
        ? { ...e, activity: { ...e.activity, status } }
        : e,
    );
  }
}
