import type {
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { foundNothing } from "../../../../shared/call-actions";
import type { AgentActivity } from "../../../../shared/projects";
import {
  claudeActivity,
  claudeCommand,
  claudeEditedPaths,
  checklistDetail,
} from "../../activity";
import type { ClaudeRunOptions } from "./config";
import { ForkParents, type ForkStart } from "../forks";
import {
  deliveryOf,
  sendOf,
  sentRow,
  type Delivery,
  type MessagedAgent,
  type Send,
} from "../send-message";
import { ClaudeTasks, isTaskTool } from "./tasks";

type Results = Exclude<SDKUserMessage["message"]["content"], string>;

/** Bash answers a non-zero exit as an error saying "Exit code N"; a search that found nothing isn't one. */
function claudeCallFailed(
  call: AgentActivity | undefined,
  isError: boolean | undefined,
  output: string,
) {
  if (!isError) return false;
  const exitCode = /^(?:Error: )?Exit code (\d+)$/m.exec(output)?.[1];
  const searchedEmpty =
    call?.kind === "command" &&
    exitCode !== undefined &&
    foundNothing(call.label, Number(exitCode));
  return !searchedEmpty;
}

/** The id of Claude's call to its advisor, a server-side tool, when `block` is one. */
export function advisorCallId(block: { type: string }) {
  const part = block as { type: string; id?: string; name?: string };
  const asksAdvisor =
    part.type === "server_tool_use" && part.name === "advisor";
  return asksAdvisor ? part.id : undefined;
}

/** The rows a turn's tool calls show as, from the call to its result. */
export class ToolRows {
  // A tool result only carries the call id; keep the call's label for the finished row.
  private calls = new Map<string, AgentActivity>();
  // A subagent's latest summary, by its call; reports between them omit it.
  private summaries = new Map<string, string>();
  private forks = new ForkParents();
  /** Forked skills' rows, by their task. */
  private forkRows = new Map<string, string>();
  /** SendMessage calls waiting on their result, which says where it went, if it did. */
  private sends = new Map<string, Send>();
  /** The message row that woke each agent this turn, by the agent's own row. */
  private wokenBy = new Map<string, string>();

  /** Calls changing the checklist, waiting on their results. */
  private taskCalls = new Map<
    string,
    { id: string; name: string; input: unknown }
  >();
  /** The turn's one checklist row, named after the first call that changed it. */
  private checklistRow?: string;

  constructor(
    private options: ClaudeRunOptions,
    private tasks = new ClaudeTasks(),
    private messaged: MessagedAgent = () => undefined,
  ) {
    tasks.beginTurn();
  }

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

  /** The row a subagent's call folds under: its agent's, or the message that woke it. */
  private rowOver(parent: string | null) {
    const agent = this.parentOf(parent);
    return this.wokenBy.get(agent ?? "") ?? agent;
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
    parent = this.rowOver(parent);
    if (!parent && isTaskTool(tool.name)) {
      this.taskCalls.set(tool.id, tool);
      return;
    }
    const activity = claudeActivity(tool.id, tool.name, tool.input);
    // A subagent's calls fold under the agent call that started it.
    if (parent) activity.parentId = parent.slice(0, 180);
    this.calls.set(tool.id, activity);
    const command = claudeCommand(tool.name, tool.input);
    if (command) this.options.onCommand?.(activity.id, command);
    this.options.onActivity?.(activity);
    const edited = claudeEditedPaths(tool.name, tool.input);
    if (edited.length) this.options.onEdit?.(edited);
    const send = sendOf(tool.name, tool.input);
    if (send) this.sends.set(tool.id, send);
  }

  /**
   * Claude asking its advisor. Both the call and the advice are blocks of
   * Claude's own message, not a tool call and a result.
   */
  advisor(block: { type: string }, parent: string | null) {
    const part = block as {
      type: string;
      tool_use_id?: string;
      content?: { type?: string };
    };
    const callId = advisorCallId(block);
    if (callId) this.call({ id: callId, name: "advisor", input: {} }, parent);
    if (part.type !== "advisor_tool_result" || !part.tool_use_id) return;
    const call = this.calls.get(part.tool_use_id);
    if (!call) return;
    const failed = part.content?.type === "advisor_tool_result_error";
    const finished: AgentActivity = {
      ...call,
      status: failed ? "failed" : "complete",
    };
    this.calls.set(finished.id, finished);
    this.options.onActivity?.(finished);
  }

  /** `returned` is what the call gave back as data, where a frame holds one result. */
  results(content: Results, parent: string | null, returned?: unknown) {
    parent = this.rowOver(parent);
    for (const result of content)
      if (result.type === "tool_result") {
        const output =
          typeof result.content === "string"
            ? result.content
            : Array.isArray(result.content)
              ? result.content
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n")
              : "";
        if (this.taskCalls.has(result.tool_use_id)) {
          this.showChecklist(result.tool_use_id, returned, {
            failed: !!result.is_error,
            output,
          });
          continue;
        }
        const call = this.calls.get(result.tool_use_id);
        const finished: AgentActivity = {
          ...(call ?? claudeActivity(result.tool_use_id, "Tool", {})),
          progress: undefined,
          ...(!call && parent ? { parentId: parent.slice(0, 180) } : {}),
          status: claudeCallFailed(call, result.is_error, output)
            ? "failed"
            : "complete",
          ...(output ? { detail: output.slice(-8000) } : {}),
        };
        const shown = this.sent(finished, output);
        this.calls.set(result.tool_use_id, shown);
        this.options.onActivity?.(shown);
      }
  }

  /**
   * One row for the turn's checklist, as it stands after each change. A call
   * that failed, or changed nothing, shows as a row of its own instead.
   */
  private showChecklist(
    id: string,
    returned: unknown,
    result: { failed: boolean; output: string },
  ) {
    const call = this.taskCalls.get(id)!;
    this.taskCalls.delete(id);
    if (!isTaskTool(call.name)) return;
    const checklist = result.failed
      ? undefined
      : this.tasks.after(call.name, call.input, returned);
    if (!checklist) return this.showUnchanged(call, returned, result);
    this.checklistRow ??= `checklist:${id}`.slice(0, 180);
    this.options.onActivity?.({
      id: this.checklistRow,
      kind: "tool",
      label: "Updated progress",
      status: "complete",
      detail: checklistDetail(checklist),
      checklist,
    });
  }

  /** A change to the checklist that didn't go through, as the call it was. */
  private showUnchanged(
    call: { id: string; name: string; input: unknown },
    returned: unknown,
    { failed, output }: { failed: boolean; output: string },
  ) {
    const refused =
      (returned as { success?: unknown } | null)?.success === false;
    this.options.onActivity?.({
      ...claudeActivity(call.id, call.name, call.input),
      status: failed || refused ? "failed" : "complete",
      ...(output ? { detail: output.slice(-8000) } : {}),
    });
  }

  /**
   * A finished call's row. A message says in its result where it went: one to
   * an agent of this session reads as that, one to another session is told on.
   */
  private sent(finished: AgentActivity, output: string) {
    const send = this.sends.get(finished.id);
    if (!send) return finished;
    this.sends.delete(finished.id);
    if (finished.status !== "complete") return finished;
    const delivery = deliveryOf(output);
    if (delivery) return this.toAgent(finished, send, delivery);
    const refused = /"success"\s*:\s*false/.test(output);
    if (!refused) this.options.onPeerSend?.(send);
    return finished;
  }

  private toAgent(row: AgentActivity, send: Send, delivery: Delivery) {
    const agent = this.messaged(send.to, delivery);
    // An agent Relay first saw as the message woke it has this row as its own.
    const hasOwnRow = agent !== undefined && agent.id !== row.id;
    // Its own row may be turns back, where what it does next would read as Claude's.
    if (hasOwnRow && delivery.how === "resumed")
      this.wokenBy.set(agent.id, row.id);
    return sentRow(row, send, delivery, agent?.description ?? send.to);
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
