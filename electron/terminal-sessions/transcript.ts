import { randomUUID } from "node:crypto";
import type {
  AgentActivity,
  ChatMessage,
  ForkPoint,
} from "../../shared/projects";
import type { TerminalAgent } from "../../shared/terminal-sessions";

/** As many trace rows as Relay keeps for one of its own answers. */
const TRACE_LIMIT = 100;
const TEXT_LIMIT = 12000;

/** A terminal session's conversation as thread messages. */
export interface Imported {
  messages: ChatMessage[];
  /** The last answer whose turn finished, and where its session can be cut after it. */
  cut?: { message: string; point: ForkPoint };
}

type Piece = { id: string; text: string };

/**
 * Builds thread messages from a session read in order: prompts, what the
 * agent said, and its tool calls, the way a live answer records them. Text
 * followed by a tool call is commentary; what is left at the end is the answer.
 */
export class Transcript {
  readonly messages: ChatMessage[] = [];
  private answer?: ChatMessage;
  private said: Piece[] = [];
  /** Where the answer's session could be cut, once its turn is known to have finished. */
  private point?: string;
  private cut?: Imported["cut"];

  constructor(
    private provider: TerminalAgent,
    private session: string,
  ) {}

  prompt(text: string, at: number) {
    this.close();
    this.messages.push({
      id: randomUUID(),
      role: "user",
      body: text.slice(0, 100_000),
      status: "complete",
      created: this.after(at),
      provider: this.provider,
      version: 1,
    });
  }

  /** Text the agent wrote; commentary if a tool call follows it. */
  text(id: string, text: string, at: number) {
    if (!text.trim()) return;
    this.open(at);
    this.said.push({ id, text });
  }

  /** Text the agent marked as commentary itself. */
  commentary(id: string, text: string, at: number) {
    if (!text.trim()) return;
    this.open(at);
    this.flush();
    this.trace({ kind: "commentary", id, text: text.slice(0, TEXT_LIMIT) });
  }

  activity(activity: AgentActivity, at: number) {
    const answer = this.open(at);
    this.flush();
    const index = (answer.trace ?? []).findIndex((e) => e.id === activity.id);
    const entry = { kind: "activity" as const, id: activity.id, activity };
    if (index >= 0) answer.trace![index] = entry;
    else this.trace(entry);
  }

  /** A call's result: the row it started, finished. */
  finished(id: string, update: Partial<AgentActivity>) {
    const entry = this.answer?.trace?.find((e) => e.id === id);
    if (entry?.kind === "activity")
      entry.activity = { ...entry.activity, ...update };
  }

  model(name: string) {
    if (this.answer && name) this.answer.model = { name, effort: "" };
  }

  stopped() {
    if (this.answer) this.answer.status = "cancelled";
  }

  /** The session can be cut here to hold the conversation up to the current answer. */
  canCut(at: string) {
    if (this.answer) this.point = at;
  }

  /** The current answer's turn finished; the session may be cut after it. */
  turnDone() {
    if (this.answer && this.point)
      this.cut = {
        message: this.answer.id,
        point: { thread: this.session, at: this.point },
      };
  }

  done(): Imported {
    this.close();
    return { messages: this.messages, ...(this.cut ? { cut: this.cut } : {}) };
  }

  private open(at: number) {
    if (!this.answer) {
      this.answer = {
        id: randomUUID(),
        role: "assistant",
        body: "",
        status: "complete",
        created: this.after(at),
        provider: this.provider,
        version: 1,
      };
      this.messages.push(this.answer);
    }
    this.answer.ended = Math.max(this.answer.created, at || 0);
    return this.answer;
  }

  private trace(entry: NonNullable<ChatMessage["trace"]>[number]) {
    const trace = (this.answer!.trace ??= []);
    if (trace.length < TRACE_LIMIT) trace.push(entry);
  }

  private flush() {
    for (const piece of this.said)
      this.trace({
        kind: "commentary",
        id: piece.id,
        text: piece.text.slice(0, TEXT_LIMIT),
      });
    this.said = [];
  }

  private close() {
    const answer = this.answer;
    if (!answer) return;
    answer.body = this.said
      .map((p) => p.text.trim())
      .join("\n\n")
      .slice(0, 200_000);
    this.said = [];
    this.point = undefined;
    // A call the session never answered ended with the turn.
    for (const entry of answer.trace ?? [])
      if (entry.kind === "activity" && entry.activity.status === "running")
        entry.activity = {
          ...entry.activity,
          status: answer.status === "complete" ? "complete" : "failed",
        };
    this.answer = undefined;
  }

  /** Messages keep their order even when the session's clock didn't. */
  private after(at: number) {
    const last = this.messages.at(-1);
    const floor = last ? Math.max(last.created, last.ended ?? 0) + 1 : 0;
    return Math.max(at || 0, floor);
  }
}
