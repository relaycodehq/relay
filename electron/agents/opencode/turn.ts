import type { z } from "zod";
import type { AgentOptions } from "../types";
import type { AskAgentRequest } from "../../../shared/agent-modes";
import { guardSteer, TurnEnd } from "../turn-kit";
import type { OpenCodeEvent, SessionCall } from "./client";
import {
  fetched,
  messageListSchema,
  OpenCodeShapeError,
  parseOpenCodeEvent,
  parseOpenCodePart,
  parseOpenCodeResponse,
  permissionListSchema,
  questionListSchema,
  readFailure,
  sessionStatusSchema,
} from "./events";
import { editedPaths, openCodeActivity, type McpTool } from "./activity";
import { openCodeFailure } from "./failure";
import { OpenCodeAnswer } from "./answer";
import { OpenCodeAsks } from "./asks";
import { OpenCodeTurnUsage } from "./turn-usage";
import { OpenCodeSubagents, openCodeSubagentBooks } from "./subagents";
import type { PermissionGrants } from "./permissions";
import type { OpenCodeTurnWatch } from "./watch";
import { imageParts, type TurnSettings } from "./prompt";

type Message = z.infer<typeof messageListSchema>[number];

const cancelled = () => new Error("Cancelled by you.");

/** The assistant's replies to the session's last prompt; a steer is a prompt too. */
function sinceLastPrompt(list: Message[]) {
  let prompt = -1;
  list.forEach((m, i) => {
    if (m.info.role === "user") prompt = i;
  });
  return list.slice(prompt + 1).filter((m) => m.info.role === "assistant");
}

/** What a turn is run with, once its session is open. */
export interface TurnSetup {
  options: AgentOptions;
  sessionID: string;
  call: SessionCall;
  /** A helper job: one-off, with no thread to keep subagents for. */
  oneOff: boolean;
  ask?: AskAgentRequest;
  grants?: PermissionGrants;
  mcpTool?: McpTool;
  watch?: OpenCodeTurnWatch;
  /** The context window of `model`, when the catalog knows it. */
  contextWindow: (model: string) => number | undefined;
}

/** One turn on an OpenCode session, from its events until the session goes idle. */
export class OpenCodeTurn {
  readonly end = new TurnEnd<string>();
  readonly answer: OpenCodeAnswer;
  readonly subagents: OpenCodeSubagents;
  /** The session is working on the turn, so going idle ends it. */
  busy = false;
  /** The turn's last assistant message, where a fork after it cuts. */
  lastMessage = "";
  private readonly usage: OpenCodeTurnUsage;
  private readonly asks: OpenCodeAsks;
  private model: string;
  private retrying = false;
  /** Events replayed from what OpenCode stored, which have no honest clock. */
  private replaying = false;
  private settling = false;
  /** The turn's own assistant messages. */
  private messages = new Set<string>();
  /** Tool calls seen so far: text before one is commentary on the way. */
  private tools = new Set<string>();
  /** Steering messages sent, until a step that started after them reads them. */
  private steers: { id?: string; after: number }[] = [];

  constructor(private readonly setup: TurnSetup) {
    const { options, call, sessionID } = setup;
    this.model = options.choice.model;
    this.answer = new OpenCodeAnswer(
      options.onText,
      options.onCommentary,
      (error) => this.finish(error),
    );
    this.usage = new OpenCodeTurnUsage(
      options,
      () => setup.contextWindow(this.model),
      (usd) => setup.watch?.requested(usd),
    );
    this.asks = new OpenCodeAsks({
      call,
      sessionID,
      signal: options.signal,
      ask: setup.ask,
      grants: setup.grants,
      readOnly: options.readOnly,
      cancelled: () => this.finish(cancelled()),
    });
    this.subagents = new OpenCodeSubagents({
      book:
        options.session?.key && !setup.oneOff
          ? openCodeSubagentBooks.open(options.session.key)
          : undefined,
      abort: (child) => call("POST", `/session/${child}/abort`),
      onActivity: options.onActivity,
      onEdit: options.onEdit,
      mcpTool: setup.mcpTool,
      get: (path) => call("GET", path),
      step: (part, model, streamed) =>
        this.usage.subagentStep(part, model, streamed),
      permission: (request) => {
        if (!this.end.settled) this.asks.permission(request);
      },
      question: (request) => {
        if (!this.end.settled) this.asks.question(request);
      },
    });
  }

  /** Ends the turn: in `error`, or in its answer so far. */
  finish(error?: Error) {
    if (error) this.end.fail(error);
    else this.end.succeed(this.answer.text);
  }

  handle = (raw: OpenCodeEvent) => {
    if (this.end.settled) return;
    let event;
    try {
      event = parseOpenCodeEvent(raw);
    } catch (error) {
      return this.rejected(error);
    }
    if (!event) return;
    const { options } = this.setup;
    switch (event.type) {
      case "relay.stream.lost":
        this.finish(
          new Error(
            event.properties.message ?? "Lost the connection to OpenCode.",
          ),
        );
        return;
      case "session.status": {
        const { status } = event.properties;
        if (status.type === "busy" || status.type === "retry") this.busy = true;
        if (status.type === "retry") {
          this.retrying = true;
          options.onCommentary?.(
            "opencode-retry",
            `Retrying (attempt ${status.attempt}): ${(status.message ?? "").slice(0, 500)}`,
          );
        } else if (this.retrying) {
          this.retrying = false;
          options.onCommentary?.("opencode-retry", null);
        }
        if (status.type === "idle" && this.busy) void this.settle();
        return;
      }
      case "session.idle":
        if (this.busy) void this.settle();
        return;
      case "session.error": {
        const error = readFailure(event.properties.error);
        this.finish(
          error?.name === "MessageAbortedError"
            ? cancelled()
            : openCodeFailure(error, "OpenCode failed to answer."),
        );
        return;
      }
      case "message.updated": {
        const { info } = event.properties;
        if (info.role !== "assistant" || this.messages.has(info.id)) {
          if (info.role === "assistant" && info.time?.completed)
            this.lastMessage = info.id;
          return;
        }
        this.messages.add(info.id);
        this.lastMessage = info.id;
        if (info.providerID && info.modelID)
          this.model = `${info.providerID}/${info.modelID}`;
        const read = this.steers.filter(
          (s) => (info.time?.created ?? 0) >= s.after,
        );
        if (read.length) {
          this.steers.splice(0, read.length);
          this.answer.steered();
          for (const steer of read) if (steer.id) options.onSteered?.(steer.id);
        }
        return;
      }
      case "message.part.updated": {
        const { part: seen } = event.properties;
        // The user's own messages and other turns' are not read.
        if (!this.messages.has(seen.messageID)) return;
        let part;
        try {
          part = parseOpenCodePart(seen);
        } catch (error) {
          return this.rejected(error);
        }
        if (!part) return;
        const { speed } = this.usage;
        if (part.type === "text" || part.type === "reasoning") {
          if (part.synthetic || part.ignored) return;
          if (part.type === "text" && !this.replaying)
            speed.text(part.messageID, part.id);
          this.answer.set(part.id, part.type, part.text, part.messageID);
          return;
        }
        if (part.type === "tool") {
          // Its first sighting, pending or already further along after a restart.
          if (!this.tools.has(part.id)) {
            this.tools.add(part.id);
            this.answer.toCommentary();
          }
          if (!this.replaying)
            speed.tool(part.messageID, part.id, part.state.status);
          this.setup.watch?.called(part.callID);
          let activity = openCodeActivity(part, this.setup.mcpTool);
          // A subagent's own calls fold under the task's row.
          if (activity && part.tool === "task")
            activity = this.subagents.task(part, activity);
          if (activity) options.onActivity?.(activity);
          const paths = editedPaths(part);
          if (paths.length) options.onEdit?.(paths);
          return;
        }
        if (part.type === "patch" && part.files) {
          options.onEdit?.(
            part.files.filter((f): f is string => typeof f === "string"),
          );
          return;
        }
        if (part.type === "step-finish")
          this.usage.step(part, this.model, !this.replaying);
        return;
      }
      case "message.part.delta": {
        const { partID, field, delta } = event.properties;
        if (field !== "text") return;
        const part = this.answer.append(partID, delta);
        if (part?.type === "text" && !this.replaying)
          this.usage.speed.text(part.messageID, partID);
        return;
      }
      case "permission.asked":
        this.asks.permission(event.properties);
        return;
      case "question.asked":
        this.asks.question(event.properties);
        return;
    }
  };

  /** The session went idle: its last assistant message says how the turn ended. */
  async settle() {
    if (this.end.settled || this.settling) return;
    this.settling = true;
    try {
      const list = await this.messageList();
      if (this.end.settled) return;
      const replies = sinceLastPrompt(list);
      const last = replies.at(-1);
      if (last?.info.error) {
        const error = readFailure(last.info.error);
        return this.finish(
          error?.name === "MessageAbortedError"
            ? cancelled()
            : openCodeFailure(error, "OpenCode failed."),
        );
      }
      if (last) this.lastMessage = last.info.id;
      // Rebuild in stored order: entire messages, text parts and tool events
      // can be missing, not just deltas. Earlier turns never supply an answer.
      this.replaying = true;
      try {
        this.answer.rebuild(() => {
          this.messages.clear();
          this.tools.clear();
          for (const reply of replies) this.replay(reply);
        });
      } finally {
        this.replaying = false;
      }
      if (this.end.settled) return;
      this.usage.sessionTotal(list);
      const { options } = this.setup;
      const answer = this.answer.text;
      if (options.job.kind !== "compact" && !answer.trim()) {
        const { denied } = this.asks;
        const blocked = denied.size
          ? ` Permission was denied for: ${[...denied].join(", ")}.`
          : "";
        return this.finish(
          new Error(
            `OpenCode stopped without a final answer.${blocked} The tool trace was kept. Retry the turn to continue.`,
          ),
        );
      }
      if (options.interactionMode === "plan" && answer.trim())
        options.onPlan?.(answer);
      this.finish();
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.settling = false;
    }
  }

  /** The event stream is the fast path; this notices a turn that ended unseen. */
  check() {
    if (this.end.settled || !this.busy) return;
    const { call, sessionID } = this.setup;
    void fetched(call, "session status", sessionStatusSchema, "/session/status")
      .then((status) => {
        if (!status[sessionID]) void this.settle();
      })
      .catch((error) => {
        if (error instanceof OpenCodeShapeError) this.finish(error);
      });
  }

  /**
   * Rebuilds the turn a restart cut off from what OpenCode stored: the
   * answers after the last prompt, and the questions still waiting.
   */
  async pickUp() {
    const { call, sessionID } = this.setup;
    const list = await this.messageList();
    this.replaying = true;
    try {
      for (const reply of sinceLastPrompt(list)) this.replay(reply);
    } finally {
      this.replaying = false;
    }
    // An OpenCode without these lists, or one that can't answer, has none waiting.
    const waiting = <T extends { sessionID?: string | null }>(
      path: string,
      what: string,
      schema: z.ZodType<T[]>,
    ) =>
      call("GET", path)
        .catch(() => [])
        .then((value) => parseOpenCodeResponse(what, schema, value))
        .then((list) =>
          list.filter(
            (r) =>
              r.sessionID === sessionID ||
              (!!r.sessionID && this.subagents.owns(r.sessionID)),
          ),
        );
    for (const request of await waiting(
      "/permission",
      "permission list",
      permissionListSchema,
    ))
      this.handle({ type: "permission.asked", properties: request });
    for (const request of await waiting(
      "/question",
      "question list",
      questionListSchema,
    ))
      this.handle({ type: "question.asked", properties: request });
    const status = parseOpenCodeResponse(
      "session status",
      sessionStatusSchema,
      await call("GET", "/session/status").catch(() => ({})),
    );
    const now = status[sessionID]?.type;
    if (now === "busy" || now === "retry") this.busy = true;
    else await this.settle();
  }

  /** Sends a steering message into the running turn, or turns it away once it's over. */
  steer(
    text: string,
    id: string | undefined,
    images: AgentOptions["images"],
    { agent, model, variant }: TurnSettings,
  ) {
    const { call, sessionID, options } = this.setup;
    return guardSteer(
      () => !this.end.settled && !options.signal.aborted,
      () => imageParts(images),
      async (attached) => {
        this.steers.push({ id, after: Date.now() });
        await call("POST", `/session/${sessionID}/prompt_async`, {
          agent,
          ...(model ? { model } : {}),
          ...(variant ? { variant } : {}),
          parts: [...(text ? [{ type: "text", text }] : []), ...attached],
        });
      },
    );
  }

  private messageList() {
    const { call, sessionID } = this.setup;
    return fetched(
      call,
      "session message list",
      messageListSchema,
      `/session/${sessionID}/message`,
    );
  }

  private replay(message: Message) {
    this.handle({
      type: "message.updated",
      properties: { info: message.info },
    });
    for (const part of message.parts ?? [])
      this.handle({ type: "message.part.updated", properties: { part } });
  }

  /** Ends the turn on what OpenCode sent wrong; any other error is a bug here. */
  private rejected(error: unknown) {
    if (!(error instanceof OpenCodeShapeError)) throw error;
    this.finish(error);
  }
}
