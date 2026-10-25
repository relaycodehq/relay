import { randomUUID } from "node:crypto";
import type { AgentProvider } from "../../shared/agents";
import type {
  AgentActivity,
  AgentTrace,
  AsyncAgentQuestions,
  ChatMessage,
  ContextUsage,
  ProjectChat,
} from "../../shared/projects";
import type { TurnModel } from "../../shared/turn-model";
import type { WatchNote } from "../../shared/watch";
import type { AgentQuestion } from "../../shared/agent-modes";
import type { HtmlRender } from "../../shared/html-render";
import type { TurnPreview } from "../../shared/preview";
import type { ImportOffer } from "../../shared/import-offer";
import { addStreamed, type Streamed } from "../../shared/usage";

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
  status: Exclude<AgentActivity["status"], "running">,
) {
  for (const a of message.activity ?? [])
    if (a.status === "running") a.status = status;
  for (const entry of message.trace ?? [])
    if (entry.kind === "activity" && entry.activity.status === "running")
      entry.activity.status = status;
}

/** The trace keeps this many calls and notes; a long turn lets its oldest finished ones go. */
const TRACE_LIMIT = 100;
/**
 * A full trace lets go of this many entries at once: each time it does, every
 * entry moves up and a phone's patch resends the whole list.
 */
const TRACE_TRIM = 10;

/**
 * Makes room in a full trace for a call or note of the agent's own: a
 * subagent's call goes first, else the oldest finished entries, counted on
 * the message so the turn's summary still adds them up. Running calls stay.
 */
function makeRoom(message: ChatMessage, trace: AgentTrace[]) {
  if (trace.length < TRACE_LIMIT) return true;
  const nested = trace.findIndex(
    (e) => e.kind === "activity" && e.activity.parentId,
  );
  if (nested >= 0) {
    trace.splice(nested, 1);
    return true;
  }
  const gone = new Set<string>();
  for (const e of trace) {
    if (gone.size >= TRACE_TRIM) break;
    if (e.kind === "commentary") gone.add(e.id);
    else if (e.activity.status !== "running") {
      gone.add(e.id);
      const kind =
        e.activity.status === "complete" ? e.activity.kind : "failed";
      const dropped = (message.traceDropped ??= {});
      dropped[kind] = (dropped[kind] ?? 0) + 1;
    }
  }
  // An agent row's calls go with it.
  const kept = trace.filter(
    (e) =>
      !gone.has(e.id) &&
      !(e.kind === "activity" && gone.has(e.activity.parentId ?? "")),
  );
  trace.splice(0, trace.length, ...kept);
  return trace.length < TRACE_LIMIT;
}

/**
 * What a turn's checkpoints may write a second. Each one writes the answer
 * whole, so at a fixed second apart a long answer's writes grow with it: an
 * answer of a few hundred KB rewrote itself every second for the rest of the
 * turn. Past this they space out, up to `checkpointMostMs` apart.
 */
const checkpointBytesPerSecond = 64 * 1024;
const checkpointLeastMs = 1000;
const checkpointMostMs = 10_000;

/**
 * The answer an agent is writing. The window sees it at most every 40ms and
 * the disk every second, or less often once the answer is long. When the
 * agent reads a steering message, the rest of the turn moves to an answer
 * below it, so read `message` as the turn goes.
 */
export class AnswerRecorder {
  private flush: ReturnType<typeof setTimeout> | null = null;
  private checkpoint: ReturnType<typeof setTimeout> | null = null;
  private checkpointMs = checkpointLeastMs;
  private model?: TurnModel;
  /** The import offer waiting for the answer to end; see `importOffer`. */
  private offer?: ImportOffer;
  /** Stopped by the user; see `stop`. */
  stopped = false;

  constructor(
    private chat: ProjectChat,
    public message: ChatMessage,
    private emit: (message: ChatMessage) => void,
    /** Writes a checkpoint; says how many bytes it wrote, when it knows. */
    private save: () => Promise<number | void> | void,
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
      // The version only moves on publish; a checkpoint reads changes by it.
      if (this.flush) {
        clearTimeout(this.flush);
        this.publish();
      }
      void Promise.resolve(this.save()).then((bytes) => {
        if (bytes)
          this.checkpointMs = Math.min(
            checkpointMostMs,
            Math.max(
              checkpointLeastMs,
              (bytes / checkpointBytesPerSecond) * 1000,
            ),
          );
      });
    }, this.checkpointMs);
  }

  text(body: string) {
    if (this.stopped) return;
    this.message.body = body;
    this.changed();
  }

  plan(body: string) {
    if (this.stopped) return;
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

  /** Adds a request's timed output, so a steer's answer below carries on from zero. */
  streamed(timed: Streamed) {
    if (this.stopped) return;
    this.message.streamed = addStreamed(this.message.streamed, timed);
    this.changed();
  }

  setModel(model: TurnModel) {
    this.model = model;
    this.message.model = model;
    this.changed();
  }

  activity(activity: AgentActivity) {
    if (this.stopped) return;
    const trace = (this.message.trace ??= []);
    const index = trace.findIndex((a) => a.id === activity.id);
    const entry = { kind: "activity" as const, id: activity.id, activity };
    if (index >= 0) trace[index] = entry;
    // A busy subagent mustn't crowd out the agent's own later calls.
    else if (
      activity.parentId
        ? trace.length < TRACE_LIMIT
        : makeRoom(this.message, trace)
    )
      trace.push(entry);
    this.changed();
  }

  /** A side check flagged something; it can land after the turn ended, on the answer it was about. */
  note(note: WatchNote) {
    if (this.stopped) return;
    (this.message.notes ??= []).push(note);
    this.changed();
  }

  /** The message the person would likely send next; the composer offers it while it's the last answer. */
  predict(text: string) {
    if (this.stopped) return;
    this.message.prediction = text;
    this.changed();
  }

  /** A page the agent showed with show_html; it sits above the reply. */
  render(render: HtmlRender) {
    if (this.stopped) return;
    (this.message.renders ??= []).push(render);
    this.changed();
  }

  /**
   * What the agent offers to import (offer_import), under the reply once it
   * ends; a later offer replaces it. It can list thousands of chats, too many
   * to copy into every publish and checkpoint while the agent writes on.
   */
  importOffer(offer: ImportOffer) {
    if (this.stopped) return;
    this.offer = offer;
  }

  /** The thread's preview as the agent left it, under the reply; a later open replaces it. */
  preview(preview: TurnPreview) {
    if (this.stopped) return;
    this.message.preview = preview;
    this.changed();
  }

  /** A page the agent asks with (ask_html): an open question until answered or skipped. */
  askPage(group: AsyncAgentQuestions) {
    if (this.stopped) return;
    (this.message.questions ??= []).push(group);
    this.chat.updated = Date.now();
    this.changed();
  }

  commentary(id: string, text: string | null) {
    if (this.stopped) return;
    const trace = (this.message.trace ??= []);
    const index = trace.findIndex((a) => a.id === id);
    if (text === null) {
      if (index >= 0) trace.splice(index, 1);
    } else {
      const entry = { kind: "commentary" as const, id, text };
      if (index >= 0) trace[index] = entry;
      else if (makeRoom(this.message, trace)) trace.push(entry);
    }
    this.changed();
  }

  questions(id: string, questions: AgentQuestion[]) {
    if (this.stopped) return;
    const groups = (this.message.questions ??= []);
    // A reattached session can replay the completed item.
    if (groups.some((group) => group.id === id)) return;
    groups.push({ id, questions });
    // A new question is unread activity even if someone read the turn earlier.
    this.chat.updated = Date.now();
    this.changed();
  }

  /**
   * The agent read a steering message: the rest of the turn continues below
   * it, so the answer to it doesn't stream into the reply above.
   */
  continueBelow(steerId: string) {
    if (this.stopped) return;
    const { chat } = this;
    const steer = chat.messages.find((m) => m.id === steerId);
    if (!steer) return;
    if (steer.unread) {
      delete steer.unread;
      steer.version++;
      this.emit(structuredClone(steer));
    }
    // A session taken back after a restart replays the steer it already read.
    if (chat.messages.indexOf(this.message) > chat.messages.indexOf(steer))
      return;
    if (this.flush) clearTimeout(this.flush);
    const above = this.message;
    if (above.body.trim() || above.trace?.length || above.activity?.length) {
      above.status = "complete";
      above.ended = Date.now();
      this.publish();
      this.message = streamingAnswer(above.provider, {
        ...(this.model ? { model: this.model } : {}),
        ...(above.parentId ? { parentId: above.parentId } : {}),
      });
    } else chat.messages.splice(chat.messages.indexOf(above), 1);
    // Messages sort by time: this lands right after the steer, above any sent later.
    this.message.created = steer.created + 1;
    chat.messages.splice(chat.messages.indexOf(steer) + 1, 0, this.message);
    this.publish();
    this.changed();
  }

  /**
   * The turn ended before the agent read steering message `steerId`. It
   * goes out with the next turn, unless `error` leaves in doubt whether the
   * agent has it anyway.
   */
  unreadSteer(steerId: string, error?: Error) {
    const steer = this.chat.messages.find((m) => m.id === steerId);
    if (!steer?.unread) return;
    delete steer.unread;
    if (error) {
      steer.status = "failed";
      steer.error = error.message;
    } else steer.missed = true;
    steer.version++;
    this.emit(structuredClone(steer));
    this.changed();
  }

  /**
   * The user stopped the turn: the answer shows as stopped now, as it stands,
   * rather than once the agent has wound down. What the agent still writes
   * meanwhile is dropped; `end` later adds what the turn changed.
   */
  stop() {
    if (this.stopped || this.message.status !== "streaming") return;
    this.stopped = true;
    this.message.status = "cancelled";
    this.message.ended = Date.now();
    this.end();
  }

  /** The turn ended with the message's status: what still ran ends with it, and the window hears it now. */
  end() {
    if (this.offer) this.message.importOffer = this.offer;
    this.offer = undefined;
    const { status } = this.message;
    settleActivities(
      this.message,
      status === "complete"
        ? "complete"
        : status === "cancelled"
          ? "stopped"
          : "failed",
    );
    if (this.flush) clearTimeout(this.flush);
    if (this.checkpoint) clearTimeout(this.checkpoint);
    this.flush = this.checkpoint = null;
    this.publish();
  }
}
