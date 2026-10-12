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
  unsubscribe?: () => void;
  done: boolean;
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
  /** Each task call's latest row, so the subagent's progress can move it. */
  private rows = new Map<string, AgentActivity>();
  private speed = new OpenCodeRequestSpeed();
  private closed = false;

  constructor(private hooks: SubagentHooks) {}

  /** The turn's task call moved on: returns its row, saying what the subagent is doing. */
  task(part: ToolPart, row: AgentActivity): AgentActivity {
    const id = part.state.metadata?.sessionId;
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
    }
    // A background task's call returns at once; its session works on, and is
    // followed until it goes idle or the turn ends.
    if (child && row.status !== "running" && !part.state.metadata?.background)
      this.end(child);
    const shown =
      child && row.status === "running" ? this.withProgress(row, child) : row;
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
    for (const child of this.children.values()) this.end(child);
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
          if (this.finished(child)) this.end(child);
          return;
        case "session.status":
          if (event.properties.status.type === "idle" && this.finished(child))
            this.end(child);
          return;
      }
    } catch (error) {
      // A subagent's odd event costs its row, not the turn.
      console.warn("OpenCode subagent event skipped:", error);
    }
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
    const paths = editedPaths(part);
    if (paths.length) this.hooks.onEdit?.(paths);
    const row = this.rows.get(activity.parentId);
    if (row?.status === "running") {
      const moved = this.withProgress(row, child);
      if (moved.progress !== row.progress) {
        this.rows.set(row.id, moved);
        this.hooks.onActivity?.(moved);
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
