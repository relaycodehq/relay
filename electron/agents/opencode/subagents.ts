import type { AgentActivity } from "../../../shared/projects";
import type { Streamed } from "../../../shared/usage";
import type { AgentOptions } from "../types";
import { editedPaths, openCodeActivity, type McpTool } from "./activity";
import { subscribe, type OpenCodeEvent } from "./client";
import {
  messageListSchema,
  parseOpenCodeEvent,
  parseOpenCodePart,
  parseOpenCodeResponse,
  type OpenCodePart,
  type PermissionRequest,
  type QuestionRequest,
  type ToolPart,
} from "./events";
import { OpenCodeRequestSpeed } from "./speed";
import { SubagentBooks, type SubagentBook } from "../subagent-book";

/** Each OpenCode session's subagents, for the composer's indicator and side thread. */
export const openCodeSubagentBooks = new SubagentBooks();

export type StepFinish = Extract<OpenCodePart, { type: "step-finish" }>;

/** What the turn does with what its subagents do. */
export type SubagentHooks = Pick<AgentOptions, "onActivity" | "onEdit"> & {
  mcpTool?: McpTool;
  /** Reads OpenCode in the turn's directory. */
  get: (path: string) => Promise<unknown>;
  /** A subagent's request finished; repeats of a step come again. */
  step(part: StepFinish, model: string, streamed: Streamed | undefined): void;
  /** The subagent asks the user, as the turn's own agent would. */
  permission(request: PermissionRequest): void;
  question(request: QuestionRequest): void;
  /** Stops one subagent's session; its task call fails and the turn goes on. */
  abort: (sessionID: string) => Promise<unknown>;
  /** The session's book, which keeps them past the turn. */
  book?: SubagentBook;
};

type Child = {
  id: string;
  /** The task call that started it; its calls fold under that row. */
  callID: string;
  /** Its own assistant messages, with the model each ran on. */
  messages: Map<string, string>;
  /** Text parts by id, for the deltas that only name the part. */
  texts: Map<string, string>;
  calls: Set<string>;
  doing?: string;
  /** Its latest text, what a background one hands back. */
  said?: string;
  unsubscribe?: () => void;
  done: boolean;
};

/** What a task call returned, without the wrapper OpenCode puts round it. */
const taskResult = (output: unknown) =>
  typeof output === "string"
    ? (/<task_(?:result|error)>\n?([\s\S]*?)\n?<\/task_(?:result|error)>/.exec(
        output,
      )?.[1] ?? output)
    : undefined;

const modelOf = (model: unknown) => {
  const m = model as { providerID?: unknown; modelID?: unknown } | undefined;
  return typeof m?.modelID === "string"
    ? typeof m.providerID === "string"
      ? `${m.providerID}/${m.modelID}`
      : m.modelID
    : undefined;
};

const doing: Partial<Record<AgentActivity["kind"], string>> = {
  command: "Running",
  file: "Editing",
  read: "Reading",
  search: "Searching",
  web: "Looking up",
};

/**
 * Follows the sessions OpenCode's `task` tool starts, which the event stream
 * names by their own id, not the turn's: their calls show folded under the
 * task's row, their requests count toward the turn, and what they ask goes
 * to the user. Their text never reaches the answer; the task's result does,
 * through the turn's own agent.
 */
export class OpenCodeSubagents {
  private children = new Map<string, Child>();
  /** Subagents the user stopped, whose task calls fail for it. */
  private stopped = new Set<string>();
  /** Each task call's latest row, so the subagent's progress can move it. */
  private rows = new Map<string, AgentActivity>();
  private speed = new OpenCodeRequestSpeed();
  private closed = false;

  constructor(private hooks: SubagentHooks) {}

  /** The turn's task call moved on: returns its row, saying what the subagent is doing. */
  task(part: ToolPart, called: AgentActivity): AgentActivity {
    const id = part.state.metadata?.sessionId;
    const row: AgentActivity =
      typeof id === "string" &&
      this.stopped.has(id) &&
      called.status === "failed"
        ? { ...called, status: "stopped" }
        : called;
    let child = typeof id === "string" ? this.children.get(id) : undefined;
    if (typeof id === "string" && !child && !this.closed) {
      child = {
        id,
        callID: part.callID,
        messages: new Map(),
        texts: new Map(),
        calls: new Set(),
        done: false,
      };
      this.children.set(id, child);
      void this.follow(child);
      const input = part.state.input ?? {};
      const text = (key: string) =>
        typeof input[key] === "string" ? (input[key] as string) : undefined;
      this.hooks.book?.start(row.id, {
        description: text("description") || row.label,
        type: text("subagent_type"),
        brief: text("prompt"),
        model: modelOf(part.state.metadata?.model),
        stop: () => {
          this.stopped.add(id);
          return this.hooks.abort(id);
        },
      });
    }
    // A background task's call returns at once; its session works on, and is
    // followed until it goes idle or the turn ends.
    const background = !!part.state.metadata?.background;
    if (child && row.status !== "running" && !background) {
      this.end(child);
      this.hooks.book?.end(
        row.id,
        row.status === "complete" ? "completed" : row.status,
        taskResult(part.state.output) ?? part.state.error ?? undefined,
      );
    }
    const shown =
      child && row.status === "running" ? this.withProgress(row, child) : row;
    if (child && row.status === "running")
      this.hooks.book?.progress(row.id, shown.progress);
    this.rows.set(row.id, shown);
    return shown;
  }

  /** Whether `sessionID` is one of the turn's subagents. */
  owns(sessionID: string) {
    return this.children.has(sessionID);
  }

  /** The turn is over: nothing more is heard from its subagents. */
  close() {
    this.closed = true;
    for (const child of this.children.values()) {
      this.end(child);
      this.hooks.book?.end(child.callID.slice(0, 180), "stopped");
    }
  }

  private async follow(child: Child) {
    try {
      child.unsubscribe = await subscribe(child.id, (event) =>
        this.handle(child, event, true),
      );
      if (child.done) return child.unsubscribe();
      // What it did before the stream named it to Relay, or before a restart.
      const list = parseOpenCodeResponse(
        "subagent message list",
        messageListSchema,
        await this.hooks.get(`/session/${child.id}/message`),
      );
      for (const message of list) {
        this.handle(
          child,
          { type: "message.updated", properties: { info: message.info } },
          false,
        );
        for (const part of message.parts ?? [])
          this.handle(
            child,
            { type: "message.part.updated", properties: { part } },
            false,
          );
      }
    } catch (error) {
      console.warn("Could not follow an OpenCode subagent:", error);
    }
  }

  private end(child: Child) {
    if (child.done) return;
    child.done = true;
    child.unsubscribe?.();
  }

  private handle(child: Child, raw: OpenCodeEvent, live: boolean) {
    if (child.done && live) return;
    let event;
    try {
      event = parseOpenCodeEvent(raw);
      if (!event) return;
      switch (event.type) {
        case "message.updated": {
          const { info } = event.properties;
          if (info.role === "assistant")
            child.messages.set(
              info.id,
              info.providerID && info.modelID
                ? `${info.providerID}/${info.modelID}`
                : (child.messages.get(info.id) ?? "opencode"),
            );
          return;
        }
        case "message.part.updated": {
          const model = child.messages.get(event.properties.part.messageID);
          if (model === undefined) return;
          const part = parseOpenCodePart(event.properties.part);
          if (part?.type === "text") {
            child.texts.set(part.id, part.messageID);
            if (live) this.speed.text(part.messageID, part.id);
            if (part.text && !part.synthetic && !part.ignored) {
              child.said = part.text;
              this.hooks.book?.say(
                child.callID.slice(0, 180),
                part.id,
                part.text,
              );
            }
          } else if (part?.type === "tool") {
            if (live)
              this.speed.tool(part.messageID, part.id, part.state.status);
            this.call(child, part);
          } else if (part?.type === "step-finish") {
            const streamed = this.speed.finish(part.messageID, part.tokens);
            this.hooks.step(part, model, live ? streamed : undefined);
          }
          return;
        }
        case "message.part.delta": {
          const messageID = child.texts.get(event.properties.partID);
          if (live && messageID && event.properties.field === "text")
            this.speed.text(messageID, event.properties.partID);
          return;
        }
        case "permission.asked":
          if (live) this.hooks.permission(event.properties);
          return;
        case "question.asked":
          if (live) this.hooks.question(event.properties);
          return;
        case "session.idle":
          if (this.finished(child)) this.settle(child);
          return;
        case "session.status":
          if (event.properties.status.type === "idle" && this.finished(child))
            this.settle(child);
          return;
      }
    } catch (error) {
      // A subagent's odd event costs its row, not the turn.
      console.warn("OpenCode subagent event skipped:", error);
    }
  }

  /** A background one went idle with its task call long back: it is done. */
  private settle(child: Child) {
    this.end(child);
    this.hooks.book?.end(child.callID.slice(0, 180), "completed", child.said);
  }

  /** Its task call is over, so an idle session won't be prompted again. */
  private finished(child: Child) {
    return this.rows.get(child.callID.slice(0, 180))?.status !== "running";
  }

  private call(child: Child, part: ToolPart) {
    const activity = openCodeActivity(part, this.hooks.mcpTool);
    if (!activity) return;
    activity.parentId = child.callID.slice(0, 180);
    child.calls.add(activity.id);
    // The call it is making now; one only being written has no input yet,
    // and one that finished late is not what it is doing.
    const status = part.state.status;
    if (status === "running" || (!child.doing && status !== "pending"))
      child.doing = [doing[activity.kind], activity.label]
        .filter(Boolean)
        .join(" ");
    this.hooks.onActivity?.(activity);
    this.hooks.book?.call(activity.parentId, activity);
    const paths = editedPaths(part);
    if (paths.length) this.hooks.onEdit?.(paths);
    const row = this.rows.get(activity.parentId);
    if (row?.status === "running") {
      const moved = this.withProgress(row, child);
      if (moved.progress !== row.progress) {
        this.rows.set(row.id, moved);
        this.hooks.onActivity?.(moved);
        this.hooks.book?.progress(row.id, moved.progress);
      }
    }
  }

  private withProgress(row: AgentActivity, child: Child): AgentActivity {
    const uses = child.calls.size;
    const progress = [
      child.doing,
      uses && `${uses} tool${uses === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300);
    return progress ? { ...row, progress } : row;
  }
}
