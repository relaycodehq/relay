import type {
  ModelRef,
  OpenCodeEvent,
  SessionEventDurable,
  SessionInfo,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { UncertainSteerError } from "../errors";
import { guardSteer } from "../turn-kit";
import { SubagentBook } from "../subagent-book";
import type { AcpAgent } from "../acp/sessions";
import type { AgentOptions } from "../types";
import { WatchChecks } from "../watch/checks";
import { TurnWatcher } from "../watch/watcher";
import { NativeEvents } from "./events";
import { nativeCall } from "./activity";
import { answerForm } from "./forms";
import { modelId, nativeUsage } from "./usage";
import type { NativeClient } from "./client";
import { messagePages } from "./messages";
import { splitModel } from "./model-ids";
import { openCodeSkillContext } from "./skills";

type PendingSteer = {
  chatId?: string;
  admission?: Promise<unknown>;
  /** OpenCode took it; its delivery comes at the next step boundary, or never. */
  admitted?: boolean;
  cancellation?: Promise<"delivered" | "returned">;
};

/** How often a steer OpenCode hasn't taken yet is looked for among its messages. */
const deliveryPoll = 500;

/** One ACP session's native observations, retained between turns for background children. */
export class OpenCodeSession {
  readonly book = new SubagentBook();
  private events: NativeEvents;
  private cursors = new Map<string, number>();
  private models = new Map<string, ModelRef>();
  private children = new Map<string, SessionInfo>();
  private tools = new Map<
    string,
    { name: string; input: Record<string, any>; created: number }
  >();
  private steers = new Map<string, PendingSteer>();
  private delivered = new Set<string>();
  private billed = new Set<string>();
  private pastCalls = new Set<string>();
  private forms = new Map<
    string,
    { abort: AbortController; sessionID: string }
  >();
  private changedChildren = new Set<string>();
  private answers = new Map<string, string>();
  private formTasks = new Set<Promise<void>>();
  private options!: AgentOptions;
  private working = false;
  private watcher?: TurnWatcher;
  private checks: WatchChecks;
  private finished = false;
  private watchingDelivery = false;
  private active = new Set<string>();
  private initializing = true;
  private since = 0;
  private begun = false;
  private point?: string;
  private pointAt = 0;
  private buffered: OpenCodeEvent[] = [];

  constructor(
    readonly id: string,
    readonly cwd: string,
    private client: NativeClient,
  ) {
    this.events = new NativeEvents(
      client,
      // All of it: hear() filters by the children start() is still listing.
      (event) =>
        this.initializing ? this.buffered.push(event) : this.hear(event),
      () => this.recover(),
    );
    this.checks = new WatchChecks(async (prompt, signal) => ({
      reply: (
        await this.client.session.generate(
          { sessionID: this.id, prompt },
          { signal },
        )
      ).text,
    }));
  }

  get failed() {
    return this.events.failed.settled;
  }

  async start(options: AgentOptions) {
    this.options = options;
    this.working = true;
    this.since = Date.now();
    if (options.job.kind === "adopt") {
      // Idle markers delimit executions, including one that finished while Relay was away.
      const messages = await this.messages(this.id, true);
      const idle = messages.filter((m) => m.type === "idle");
      const active = await this.client.session.active();
      const boundary = idle[active[this.id] ? 0 : 1];
      this.since = boundary?.time.created ?? 0;
    }
    await this.events.start(options.signal);
    await this.recover();
    this.initializing = false;
    for (const event of this.buffered.splice(0)) this.hear(event);
  }

  begin(options: AgentOptions, agent: AcpAgent) {
    this.options = options;
    if (this.begun) {
      this.since = Date.now();
      this.billed.clear();
      this.pastCalls.clear();
    }
    this.begun = true;
    this.point = undefined;
    this.pointAt = 0;
    this.delivered.clear();
    this.finished = false;
    this.working = true;
    this.watcher = options.watch
      ? new TurnWatcher(options.watch, this.checks, options.signal, () => {
          if (options.watch?.scope !== "subagents") return [];
          const changed = [...this.changedChildren];
          this.changedChildren.clear();
          return changed.flatMap((id) => {
            const detail = this.book.detail(id);
            return detail
              ? [
                  {
                    task: detail.description,
                    digest: JSON.stringify(detail.trace).slice(-12000),
                  },
                ]
              : [];
          });
        })
      : undefined;
    this.watcher?.called([...this.pastCalls]);
    this.pastCalls.clear();
    if (options.job.kind !== "compact")
      options.onControl?.({
        steer: (text, chatId, images, request) =>
          guardSteer(
            () =>
              this.working &&
              !options.signal.aborted &&
              !this.events.failed.settled,
            async () => {
              const files = await Promise.all(
                (images ?? []).map(async (image) => ({
                  uri: `data:${image.mimeType};base64,${(await readFile(image.path)).toString("base64")}`,
                })),
              );
              const skills = await openCodeSkillContext({
                ...options,
                prompt: text,
                request,
              });
              return { text: [...skills, text].join("\n\n"), files };
            },
            async (input) => {
              const id = `msg_${randomUUID().replaceAll("-", "")}`;
              const pending: PendingSteer = { chatId };
              this.steers.set(id, pending);
              // resume:false cannot accidentally start an unobserved turn after ACP settles.
              pending.admission = this.client.session.prompt({
                sessionID: this.id,
                id,
                ...input,
                delivery: "steer",
                resume: false,
              });
              try {
                await pending.admission;
              } catch (error) {
                // A lost reply may have applied; recover delivery before deciding.
                // If recovery is also unavailable, only a confirmed cancellation is safe to retry.
                await this.drain(this.id).catch(() => {});
                if ((await this.cancelSteer(id, pending)) === "returned")
                  throw error;
                return;
              }
              // Delivery can be minutes away, behind a long tool call: the
              // thread mustn't wait for it. settle() reports one never read.
              pending.admitted = true;
              void this.watchDelivery();
            },
          ),
        retune: async (choice) => {
          if (!this.working || options.signal.aborted) return false;
          const current = await this.client.session.get({ sessionID: this.id });
          const baseModel = agent.session?.base?.model;
          const split = splitModel(choice.model || baseModel || "");
          const model = split
            ? { providerID: split.providerID, id: split.modelID }
            : current.model;
          if (!model) return false;
          const all = (
            await this.client.model.list({ location: { directory: this.cwd } })
          ).data;
          const offered = all.find(
            (m) => m.id === model.id && m.providerID === model.providerID,
          );
          const effort = choice.reasoningEffort;
          if (effort && !offered?.variants.some((v) => v.id === effort))
            return false;
          if (!this.working || options.signal.aborted) return false;
          await this.client.session.switchModel({
            sessionID: this.id,
            model: { ...model, variant: effort || undefined },
          });
          // Keep ACP's cached selection in sync, so it doesn't undo a native retune next turn.
          const settings = agent.session?.settings;
          const modelOption = settings?.configOptions?.find(
            (o) => o.category === "model" || o.id === "model",
          );
          const effortOption = settings?.configOptions?.find(
            (o) => o.category === "thought_level",
          );
          if (modelOption) modelOption.currentValue = modelId(model);
          if (effortOption) effortOption.currentValue = effort || "default";
          return true;
        },
      });
    return { settle: () => this.settle(), failure: this.events.failed.promise };
  }

  async settle() {
    if (this.finished) return;
    this.finished = true;
    this.working = false;
    await Promise.allSettled([...this.steers.values()].map((p) => p.admission));
    try {
      // The answer stands without it; each steer below settles its own delivery.
      await this.recover().catch((e) =>
        console.warn("Could not recover OpenCode's last events:", e),
      );
      // One whose admission failed belongs to the steer call still deciding it.
      for (const [id, pending] of this.steers) {
        if (!pending.admitted) continue;
        const outcome = await this.cancelSteer(id, pending).catch(
          (error: Error) => error,
        );
        if (outcome !== "delivered" && pending.chatId)
          this.options.onSteerUnread?.(
            pending.chatId,
            outcome === "returned" ? undefined : outcome,
          );
      }
    } finally {
      const forms = [...this.forms.entries()];
      for (const [, { abort }] of forms) abort.abort();
      await Promise.allSettled(
        forms.map(([formID, { sessionID }]) =>
          this.client.session.form.cancel({ sessionID, formID }),
        ),
      );
      await Promise.allSettled([...this.formTasks]);
    }
  }

  async ended(answer: string) {
    this.watcher?.ended(answer);
    await this.checks.idle();
    // A fork point includes the last message, rather than cutting before the answer.
    if (this.point) {
      this.options.session?.onPoint?.(this.point);
      return;
    }
    const messages = await this.client.message
      .list({ sessionID: this.id, order: "desc", limit: 1 })
      .catch(() => undefined);
    const last = messages?.data[0];
    if (last) this.options.session?.onPoint?.(last.id);
  }

  close() {
    this.working = false;
    this.events.close();
    for (const { abort } of this.forms.values()) abort.abort();
    this.book.close();
  }

  private cancelSteer(id: string, pending: PendingSteer) {
    return (pending.cancellation ??= this.finishSteer(id));
  }

  /** "returned": confirmed never delivered. Throws when that can't be told. */
  private async finishSteer(id: string) {
    try {
      if (this.delivered.has(id)) return "delivered";
      try {
        await this.client.session.inbox.cancel({
          sessionID: this.id,
          inboxID: id,
        });
        return "returned";
      } catch {
        await this.drain(this.id).catch(() => {});
        if (this.delivered.has(id)) return "delivered";
        // Do not report an undelivered message as accepted.
        throw new UncertainSteerError();
      }
    } finally {
      this.steers.delete(id);
    }
  }

  private async messages(sessionID: string, all = false) {
    const messages: SessionMessageInfo[] = [];
    for await (const page of messagePages(this.client, {
      sessionID,
      order: "desc",
      limit: 20,
    })) {
      messages.push(...page);
      if (!all && page.some((m) => m.time.created < this.since)) break;
    }
    return messages;
  }

  /** The newest main-session message so far, whether an event or recovery saw it. */
  private reached(messageID: string, at: number) {
    if (at < this.pointAt) return;
    this.point = messageID;
    this.pointAt = at;
  }

  /**
   * OpenCode 2.1 takes a steer without saying so on its event stream: the
   * waiting message just becomes a user message. Look for it while one
   * waits, so what answers it goes below it, not above once the turn ends.
   */
  private async watchDelivery() {
    if (this.watchingDelivery) return;
    this.watchingDelivery = true;
    try {
      while (this.working) {
        const waiting = [...this.steers.entries()].filter(
          ([id, pending]) => pending.admitted && !this.delivered.has(id),
        );
        if (!waiting.length) return;
        await delay(deliveryPoll);
        for (const [id] of waiting) {
          if (!this.working || this.delivered.has(id)) continue;
          const message = await this.client.session.message
            .get({ sessionID: this.id, messageID: id })
            .catch(() => undefined);
          if (message?.type === "user") this.deliveredSteer(id);
        }
      }
    } finally {
      this.watchingDelivery = false;
    }
  }

  private deliveredSteer(id: string) {
    const pending = this.steers.get(id);
    if (!pending || this.delivered.has(id)) return;
    this.delivered.add(id);
    if (pending.chatId) this.options.onSteered?.(pending.chatId);
  }

  private report(
    sessionID: string,
    id: string,
    model: ModelRef,
    tokens: TokenUsageInfo,
    cost: number | undefined,
    created: number,
  ) {
    const key = `${sessionID}:${id}`;
    if (this.billed.has(key) || created < this.since) return;
    this.billed.add(key);
    const child = sessionID !== this.id;
    this.options.onUsage?.({
      ...nativeUsage(model, tokens, cost),
      ...(child ? { subagent: true } : {}),
    });
    if (cost) this.options.onCost?.(cost);
  }

  /** Saved messages recover missed events; v2's experimental log is live-only on 2.0.32. */
  private async drain(sessionID: string) {
    const child = sessionID !== this.id;
    const messages = await this.messages(sessionID);
    for (const message of [...messages].reverse()) {
      if (message.type === "user") this.deliveredSteer(message.id);
      if (message.type !== "assistant") continue;
      if (!child && message.time.created >= this.since)
        this.reached(message.id, message.time.created);
      if (message.tokens)
        this.report(
          sessionID,
          message.id,
          message.model,
          message.tokens,
          message.cost,
          message.time.completed ?? message.time.created,
        );
      for (const [ordinal, part] of message.content.entries()) {
        if (part.type === "tool") {
          if (!child && message.time.created >= this.since)
            this.pastCalls.add(part.id);
          if (!child) continue;
          const { activity, edits } = nativeCall(part);
          this.book.call(sessionID, activity);
          if (message.time.created >= this.since) {
            this.options.onActivity?.({ ...activity, parentId: sessionID });
            if (edits.length) {
              this.changedChildren.add(sessionID);
              this.options.onEdit?.(
                edits.map((path) =>
                  resolve(
                    this.children.get(sessionID)?.location.directory ??
                      this.cwd,
                    path,
                  ),
                ),
              );
            }
          }
        }
        if (child && part.type === "text") {
          this.book.say(sessionID, `${message.id}:${ordinal}`, part.text);
          this.answers.set(sessionID, part.text);
        }
      }
    }
    // A steer can have been promoted beyond the most recent message page.
    if (sessionID === this.id)
      for (const id of this.steers.keys()) {
        if (this.delivered.has(id)) continue;
        const message = await this.client.session.message
          .get({ sessionID, messageID: id })
          .catch(() => undefined);
        if (message?.type === "user") this.deliveredSteer(id);
      }
  }

  private async recover() {
    const active = await this.client.session.active();
    this.active = new Set(Object.keys(active));
    const visit = async (parentID: string) => {
      let cursor: string | undefined;
      do {
        const page = await this.client.session.list({
          parentID,
          limit: 100,
          cursor,
        });
        for (const child of page.data) {
          if (child.fork) continue;
          const previous = this.children.get(child.id);
          const changed =
            !previous ||
            previous.time.updated !== child.time.updated ||
            this.active.has(child.id) ||
            this.book.detail(child.id)?.status === "running";
          this.child(child);
          if (changed) {
            await this.drain(child.id);
            // Without an outcome it never ran; one that starts later resumes.
            if (!this.active.has(child.id))
              this.book.end(
                child.id,
                child.outcome === "succeeded"
                  ? "completed"
                  : child.outcome === "failed"
                    ? "failed"
                    : "stopped",
                this.answers.get(child.id),
              );
          }
          // A finished worker's own background workers can still change.
          await visit(child.id);
        }
        cursor = page.cursor.next ?? undefined;
      } while (cursor);
    };
    await visit(this.id);
    await this.drain(this.id);
    if (!this.working) return;
    for (const sessionID of [this.id, ...this.children.keys()]) {
      const forms = await this.client.session.form.list({ sessionID });
      for (const form of forms) this.form(sessionID, form.id);
    }
  }

  private child(info: SessionInfo) {
    if (info.fork) return; // A /btw or branch is not a spawned worker.
    this.children.set(info.id, info);
    this.book.start(info.id, {
      description: info.title || "OpenCode subagent",
      type: info.agent,
      model: info.model ? modelId(info.model) : undefined,
      parentId: info.parentID === this.id ? undefined : info.parentID,
      stop: () =>
        this.client.session.interrupt({ sessionID: info.id, resume: false }),
    });
    if (this.active.has(info.id)) {
      this.book.resume(info.id);
      this.options.onActivity?.({
        id: info.id,
        kind: "agent",
        label: info.title || "OpenCode subagent",
        status: "running",
      });
    }
  }

  private form(sessionID: string, formID: string) {
    if (this.forms.has(formID) || !this.working) return;
    const abort = new AbortController();
    this.forms.set(formID, { abort, sessionID });
    const signal = AbortSignal.any([abort.signal, this.options.signal]);
    const task = (async () => {
      const form = await this.client.session.form.get(
        { sessionID, formID },
        { signal },
      );
      if (form.state.status === "pending")
        await answerForm(this.client, form, this.options.onRequest, signal);
    })()
      .catch(() => {
        if (!signal.aborted)
          this.events.failed.fail(
            new Error(
              "Couldn't answer OpenCode's question. Resume the answer to try again.",
            ),
          );
      })
      .finally(() => {
        this.forms.delete(formID);
        this.formTasks.delete(task);
      });
    this.formTasks.add(task);
  }

  private hear(event: OpenCodeEvent | SessionEventDurable) {
    if (event.type === "form.created") {
      const form = event.data.form;
      if (form.sessionID === this.id || this.children.has(form.sessionID))
        this.form(form.sessionID, form.id);
      return;
    }
    if (event.type === "form.replied" || event.type === "form.cancelled") {
      this.forms.get(event.data.id)?.abort.abort();
      return;
    }
    if (
      event.type === "session.created" &&
      event.data.parentID &&
      (event.data.parentID === this.id ||
        this.children.has(event.data.parentID))
    ) {
      const data = event.data;
      this.child({
        ...data,
        id: data.sessionID,
        time: { created: event.created, updated: event.created },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      });
    }
    if (!("durable" in event) || !("sessionID" in event.data)) return;
    const native = event as SessionEventDurable;
    const sessionID = native.data.sessionID;
    if (sessionID !== this.id && !this.children.has(sessionID)) return;
    if (native.durable.seq <= (this.cursors.get(sessionID) ?? 0)) return;
    this.cursors.set(sessionID, native.durable.seq);
    const child = sessionID !== this.id;
    switch (native.type) {
      case "session.inbox.delivered": {
        this.deliveredSteer(native.data.inboxID);
        return;
      }
      case "session.execution.started":
        this.active.add(sessionID);
        if (child) {
          this.book.resume(sessionID);
          this.book.name(sessionID, {
            stop: () =>
              this.client.session.interrupt({ sessionID, resume: false }),
          });
          this.answers.delete(sessionID);
          this.options.onActivity?.({
            id: sessionID,
            kind: "agent",
            label: this.children.get(sessionID)?.title || "OpenCode subagent",
            status: "running",
          });
        }
        return;
      case "session.step.started":
        this.models.set(native.data.assistantMessageID, native.data.model);
        return;
      case "session.step.ended":
      case "session.step.failed": {
        const data = native.data;
        if (!child) this.reached(data.assistantMessageID, native.created);
        const model = this.models.get(data.assistantMessageID);
        if (model && data.tokens)
          this.report(
            sessionID,
            data.assistantMessageID,
            model,
            data.tokens,
            data.cost,
            native.created,
          );
        if (!this.initializing || native.created >= this.since)
          for (const file of data.files ?? []) {
            this.options.onEdit?.([
              resolve(
                this.children.get(sessionID)?.location.directory ?? this.cwd,
                file,
              ),
            ]);
            if (child) this.changedChildren.add(sessionID);
          }
        this.models.delete(data.assistantMessageID);
        return;
      }
      case "session.tool.input.started":
        this.tools.set(native.data.id, {
          name: native.data.name,
          input: {},
          created: native.created,
        });
        if (!child) this.watcher?.called([native.data.id]);
        return;
      case "session.tool.called": {
        const tool = this.tools.get(native.data.id);
        if (tool) tool.input = native.data.input;
        if (child)
          this.call(sessionID, native.data.id, {
            status: "running",
            input: native.data.input,
            metadata: {},
          });
        return;
      }
      case "session.tool.success":
      case "session.tool.failed": {
        if (child)
          this.call(
            sessionID,
            native.data.id,
            native.type === "session.tool.success"
              ? {
                  status: "completed",
                  input: this.tools.get(native.data.id)?.input ?? {},
                  content: native.data.content,
                  metadata: native.data.metadata,
                }
              : {
                  status: "error",
                  input: this.tools.get(native.data.id)?.input ?? {},
                  error: native.data.error,
                  content: native.data.content,
                },
          );
        this.tools.delete(native.data.id);
        return;
      }
      case "session.text.ended":
        if (child) {
          this.book.say(
            sessionID,
            `${native.data.assistantMessageID}:${native.data.ordinal}`,
            native.data.text,
          );
          this.answers.set(sessionID, native.data.text);
        }
        return;
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        this.active.delete(sessionID);
        if (child) {
          const status =
            native.type === "session.execution.succeeded"
              ? "completed"
              : native.type === "session.execution.failed"
                ? "failed"
                : "stopped";
          this.book.end(sessionID, status, this.answers.get(sessionID));
          this.options.onActivity?.({
            id: sessionID,
            kind: "agent",
            label: this.children.get(sessionID)?.title || "OpenCode subagent",
            status: status === "completed" ? "complete" : status,
          });
        }
        return;
    }
  }

  private call(
    sessionID: string,
    id: string,
    state: SessionMessageAssistantTool["state"],
  ) {
    const known = this.tools.get(id);
    if (!known) return;
    const { activity, edits } = nativeCall({
      id,
      type: "tool",
      name: known.name,
      state,
      time: { created: known.created },
    });
    this.book.call(sessionID, activity);
    this.options.onActivity?.({ ...activity, parentId: sessionID });
    if (edits.length) {
      this.changedChildren.add(sessionID);
      this.options.onEdit?.(
        edits.map((path) =>
          resolve(
            this.children.get(sessionID)?.location.directory ?? this.cwd,
            path,
          ),
        ),
      );
    }
  }
}
