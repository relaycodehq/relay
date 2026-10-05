import { randomUUID } from "node:crypto";
import type {
  SDKAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  answeredFindings,
  reportedFindings,
} from "../../../../shared/deep-review";
import { ClaudeFailureWatch } from "../claude-failure";
import type { ClaudeRunOptions } from "./config";
import { answerLimitError } from "../../turn-kit";
import { ContextMeter } from "./context";
import type { SDKMessage } from "./sdk";
import { watchOf, type ClaudeSession } from "./session";
import { ToolRows } from "./tool-rows";
import { TurnWatcher } from "../../watch/watcher";

/**
 * What a frame leaves the turn to do: read on, see whether Claude runs a
 * steer it couldn't fold in as a follow-up turn, or finish with the answer.
 */
type Verdict = "more" | "follow-up" | { answer: string };

/** Reads one turn's frames into its answer, as they come. */
export class ClaudeTurnReader {
  private answer = "";
  private currentText = "";
  private currentMessage = "";
  // Earlier answers in this turn, when a late steer ran as a follow-up turn.
  private before = "";
  steerable = true;
  // Steers Claude hasn't finished with, by the uuid sent with them. Claude
  // reports each one's progress; `state` stays unset on CLIs that don't.
  private steering = new Map<string, { id?: string; state?: string }>();
  // The prompt's own progress, on CLIs that report it.
  readonly prompt: { uuid: ReturnType<typeof randomUUID>; state?: string } = {
    uuid: randomUUID(),
  };
  // Text followed by a tool call is commentary, not the answer. Keep it out of the body.
  private commentary = new Set<string>();
  // Findings `/code-review` reported to its tool rather than in its answer.
  private reported?: string;
  private failures = new ClaudeFailureWatch();
  // After a compact boundary, the next synthetic user message is the summary.
  private compacted?: string;
  private rows: ToolRows;
  private meter: ContextMeter;
  private watcher?: TurnWatcher;

  constructor(
    private options: ClaudeRunOptions,
    private session: ClaudeSession,
  ) {
    this.rows = new ToolRows(options);
    this.meter = new ContextMeter(options, session);
    if (options.watch)
      this.watcher = new TurnWatcher(
        options.watch,
        watchOf(session).checks,
        options.signal,
      );
  }

  /** The answer so far, follow-ups included. */
  get text() {
    return this.before + this.answer;
  }

  /** A steer went out with `uuid`, for the queued message `id`. */
  track(uuid: string, id?: string) {
    this.steering.set(uuid, { id });
  }

  /** Claude runs a late steer as a turn of its own; its answer goes below this one. */
  followUp() {
    this.before += this.answer + "\n\n";
    this.answer = "";
    this.steerable = true;
  }

  read(message: SDKMessage): Verdict {
    this.lifecycle(message);
    if (message.type === "stream_event" && !message.parent_tool_use_id)
      this.streamed(message.event);
    if (message.type === "system" && message.subtype === "compact_boundary") {
      this.meter.compacted(message.compact_metadata.post_tokens ?? 0);
      this.compacted = "";
    }
    if (
      this.compacted === "" &&
      message.type === "user" &&
      message.isSynthetic &&
      !message.parent_tool_use_id
    ) {
      const content = message.message.content;
      this.compacted =
        typeof content === "string"
          ? content
          : content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    }
    this.failures.see(message);
    if (message.type === "assistant") this.said(message);
    if (message.type === "user" && Array.isArray(message.message.content))
      this.rows.results(message.message.content, message.parent_tool_use_id);
    if (message.type === "system" && message.subtype === "task_progress")
      this.rows.progress(message);
    if (message.type === "result") return this.result(message);
    return "more";
  }

  private publish(text: string) {
    // The limit is on the whole answer shown and saved, follow-ups included.
    const over = answerLimitError(this.before.length + text.length);
    if (over) throw over;
    this.answer = text;
    this.options.onText(this.before + text);
  }

  private lifecycle(message: SDKMessage) {
    // Not in the SDK's types: queued input reports queued, started, completed.
    const lifecycle = message as {
      type: string;
      command_uuid?: string;
      state?: string;
    };
    if (lifecycle.type !== "command_lifecycle") return;
    const steer = this.steering.get(lifecycle.command_uuid ?? "");
    if (steer) {
      steer.state = lifecycle.state;
      if (lifecycle.state === "started") {
        // Claude read the message; what follows answers it, below it.
        this.before = this.answer = "";
        this.steerable = true;
        if (steer.id) this.options.onSteered?.(steer.id);
      } else if (lifecycle.state !== "queued")
        this.steering.delete(lifecycle.command_uuid!);
    }
    if (lifecycle.command_uuid === this.prompt.uuid) {
      this.prompt.state = lifecycle.state;
      // Text before Claude picked the prompt up answered something else.
      if (this.prompt.state === "started" && this.answer) this.publish("");
    }
  }

  private streamed(
    event: Extract<SDKMessage, { type: "stream_event" }>["event"],
  ) {
    if (event.type === "message_start") {
      this.currentText = "";
      this.currentMessage = event.message.id;
      this.meter.started(event.message.id);
    }
    if (
      event.type === "content_block_start" &&
      event.content_block.type === "tool_use" &&
      this.currentText.trim()
    ) {
      this.commentary.add(this.currentMessage);
      this.options.onCommentary?.(this.currentMessage, this.currentText);
      this.currentText = "";
      this.publish("");
    }
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      this.currentText += event.delta.text;
      this.publish(this.currentText);
    }
  }

  private said(message: SDKAssistantMessage) {
    const parent = message.parent_tool_use_id;
    if (!parent) {
      // The newest entry of the main conversation is where a fork continues.
      this.options.session?.onPoint?.(message.uuid);
      this.meter.replied(message.message);
    }
    const text = message.message.content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    const tools = message.message.content.filter((p) => p.type === "tool_use");
    if (tools.length && text && !parent) {
      this.commentary.add(message.message.id);
      this.options.onCommentary?.(message.message.id, text);
    }
    for (const tool of tools) {
      if (tool.name === "ReportFindings" && !parent)
        this.reported = reportedFindings(tool.input) ?? this.reported;
      this.rows.call(tool, parent);
    }
    // Subagents are the session's to watch: most outlive the turn.
    if (!parent) this.watcher?.called(tools.map((tool) => tool.id));
    if (
      text &&
      !tools.length &&
      !parent &&
      !this.commentary.has(message.message.id)
    )
      this.publish(text);
  }

  private result(message: SDKResultMessage): Verdict {
    // Claude finishes what it queued before the prompt first: resuming a
    // session reports a background command the last process left running
    // with a result of its own, sometimes before the prompt is even queued.
    const origin = (message as { origin?: { kind?: string } }).origin;
    const state = this.prompt.state;
    if (
      this.options.job.kind !== "adopt" &&
      (state === "queued" ||
        (state !== "started" && origin && origin.kind !== "human"))
    )
      return "more";
    this.steerable = false;
    const failed = message.is_error || message.subtype !== "success";
    const stopped = this.failures.failure(failed);
    if (stopped) throw stopped;
    if (failed) throw new Error("Claude could not complete this turn.");
    this.meter.finished(message.modelUsage);
    if (this.options.job.kind === "compact")
      return { answer: this.compacted ?? "" };
    const plan = this.session.plan;
    const final = plan || message.result || this.answer;
    const written = plan ? undefined : answeredFindings(final);
    this.publish(
      written ??
        (this.reported && !plan
          ? [final, this.reported].filter((part) => part.trim()).join("\n\n")
          : final),
    );
    // A turn Claude started itself may only have run tools.
    if (!this.answer.trim() && this.options.job.kind !== "adopt")
      throw new Error("Claude returned an empty answer.");
    const steers = [...this.steering.values()];
    // A steer Claude didn't get to runs as its own turn right after this one.
    if (steers.some((s) => s.state === "queued")) return "more";
    if (steers.some((s) => !s.state)) {
      this.steering.clear();
      return "follow-up";
    }
    return { answer: this.text };
  }
}
