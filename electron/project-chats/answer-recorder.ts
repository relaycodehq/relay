import { randomUUID } from "node:crypto";
import type { AgentProvider } from "../../shared/agents";
import type {
  AgentActivity,
  ChatMessage,
  ContextUsage,
  ProjectChat,
} from "../../shared/projects";
import type { TurnModel } from "../../shared/turn-model";

/** A fresh assistant message the agent is about to stream into. */
export const streamingAnswer = (
  provider: AgentProvider,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: randomUUID(),
  role: "assistant",
  body: "",
  status: "streaming",
  provider,
  created: Date.now(),
  version: 1,
  ...extra,
});

/** What an ended answer still showed as running ends with it. */
export function settleActivities(
  message: ChatMessage,
  status: "complete" | "failed",
) {
  for (const a of message.activity ?? [])
    if (a.status === "running") a.status = status;
  for (const entry of message.trace ?? [])
    if (entry.kind === "activity" && entry.activity.status === "running")
      entry.activity.status = status;
}

/** The trace keeps this many calls and notes; a long turn drops the rest. */
const TRACE_LIMIT = 100;

/**
 * The answer an agent is writing. The window sees it at most every 40ms and
 * the disk every second. When the agent reads a steering message, the rest of
 * the turn moves to an answer below it, so read `message` as the turn goes.
 */
export class AnswerRecorder {
  private flush: ReturnType<typeof setTimeout> | null = null;
  private checkpoint: ReturnType<typeof setTimeout> | null = null;
  private model?: TurnModel;
  constructor(
    private chat: ProjectChat,
    public message: ChatMessage,
    private emit: (message: ChatMessage) => void,
    private save: () => void,
  ) {}
  publish() {
    this.flush = null;
    this.message.version++;
    this.emit(structuredClone(this.message));
  }
  changed() {
    this.flush ??= setTimeout(() => this.publish(), 40);
    this.checkpoint ??= setTimeout(() => {
      this.checkpoint = null;
      this.save();
    }, 1000);
  }
  text(body: string) {
    this.message.body = body;
    this.changed();
  }
  plan(body: string) {
    this.message.proposedPlan = true;
    this.text(body);
  }
  context(usage: ContextUsage) {
    this.message.context = usage;
    this.changed();
  }
  /** Adds to this answer's cost, so a steer's answer below carries on from zero. */
  cost(usd: number) {
    this.message.cost = (this.message.cost ?? 0) + usd;
    this.changed();
  }
  setModel(model: TurnModel) {
    this.model = model;
    this.message.model = model;
    this.changed();
  }
  activity(activity: AgentActivity) {
    const trace = (this.message.trace ??= []);
    const index = trace.findIndex((a) => a.id === activity.id);
    const entry = { kind: "activity" as const, id: activity.id, activity };
    // A busy subagent mustn't crowd out Claude's own later calls.
    if (index < 0 && trace.length >= TRACE_LIMIT && !activity.parentId) {
      const nested = trace.findIndex(
        (e) => e.kind === "activity" && e.activity.parentId,
      );
      if (nested >= 0) trace.splice(nested, 1);
    }
    if (index >= 0) trace[index] = entry;
    else if (trace.length < TRACE_LIMIT) trace.push(entry);
    this.changed();
  }
  commentary(id: string, text: string | null) {
    const trace = (this.message.trace ??= []);
    const index = trace.findIndex((a) => a.id === id);
    if (text === null) {
      if (index >= 0) trace.splice(index, 1);
    } else {
      const entry = {
        kind: "commentary" as const,
        id,
        text: text.slice(0, 12000),
      };
      if (index >= 0) trace[index] = entry;
      else if (trace.length < TRACE_LIMIT) trace.push(entry);
    }
    this.changed();
  }
  /**
   * The agent read a steering message: the rest of the turn continues below
   * it, so the answer to it doesn't stream into the reply above.
   */
  continueBelow(steerId: string) {
    const { chat } = this;
    const steer = chat.messages.find((m) => m.id === steerId);
    if (!steer) return;
    if (steer.unread) {
      delete steer.unread;
      steer.version++;
      this.emit(structuredClone(steer));
    }
    if (this.flush) clearTimeout(this.flush);
    const above = this.message;
    if (above.body.trim() || above.trace?.length || above.activity?.length) {
      above.status = "complete";
      above.ended = Date.now();
      this.publish();
      this.message = streamingAnswer(above.provider, {
        ...(this.model ? { model: this.model } : {}),
        ...(above.parentId ? { parentId: above.parentId } : {}),
        ...(chat.shared ? { pending: true } : {}),
      });
    } else chat.messages.splice(chat.messages.indexOf(above), 1);
    // Messages sort by time: this lands right after the steer, above any sent later.
    this.message.created = steer.created + 1;
    chat.messages.splice(chat.messages.indexOf(steer) + 1, 0, this.message);
    this.publish();
    this.changed();
  }
  /** The turn ended with the message's status: what still ran ends with it, and the window hears it now. */
  end() {
    settleActivities(
      this.message,
      this.message.status === "complete" ? "complete" : "failed",
    );
    if (this.flush) clearTimeout(this.flush);
    if (this.checkpoint) clearTimeout(this.checkpoint);
    this.flush = this.checkpoint = null;
    this.publish();
  }
}
