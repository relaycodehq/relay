import type { HtmlRender } from "../../shared/html-render";
import type { TurnPreview } from "../../shared/preview";
import type { ImportOffer } from "../../shared/import-offer";
import type {
  AgentProvider,
  AsyncAgentQuestions,
  ChatMessage,
  ProjectChatSend,
} from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import type { TurnEnd, TurnKind } from "../../shared/turns";
import { AgentRequests } from "./agent-requests";
import type { AgentOptions } from "../agents/types";
import { MemoryTurnStore, TurnLedger } from "../turns";
import { withTimeout } from "../util/timeout";

export type AgentControl = Parameters<
  NonNullable<AgentOptions["onControl"]>
>[0];

export interface ActiveChat {
  /** The turn in the ledger; see docs/turn-lifecycle.md. */
  turnId: string;
  requests: AgentRequests;
  abort: AbortController;
  job?: Promise<unknown>;
  input?: ProjectChatSend;
  steer?: AgentControl["steer"];
  /** Adds a page the agent showed to the answer it is writing. */
  render?: (render: HtmlRender) => void;
  /** Leaves the thread's preview under the answer; `answerId` names the answer it lands in. */
  preview?: (preview: TurnPreview) => void;
  answerId?: () => string;
  /** Leaves what the agent offers to import under the answer; a later offer replaces it. */
  importOffer?: (offer: ImportOffer) => void;
  /** Leaves a page the agent asks with in the answer, as an open question. */
  askPage?: (group: AsyncAgentQuestions) => void;
  /** Counts the rest of the answer's edits in the worktree the thread just moved to. */
  moved?: (root: string) => Promise<void>;
  /** Pauses or clears the goal the turn pursues; Codex only. */
  goal?: AgentControl["goal"];
  retune?: AgentControl["retune"];
  /** Settles once the turn gives the thread back; see `release`. */
  ended: Promise<void>;
  /** Stopped to send a steer it hadn't read: the queue goes on after that. */
  keepsQueue?: boolean;
  /** The message the turn writes; how it ended is how the turn did. */
  answer?: () => ChatMessage;
  end: () => void;
}

interface Side {
  turnId: string;
  abort: AbortController;
  job: Promise<unknown>;
  answer: ChatMessage;
}

/** How a turn ended, from the message it wrote. */
export function outcome(
  answer: ChatMessage | undefined,
  stopped: boolean,
): TurnEnd {
  switch (answer?.status) {
    case "complete":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "streaming":
      return stopped ? "cancelled" : "lost";
    default:
      return "unstarted";
  }
}

/**
 * Each thread's one running turn, and the side questions answered beside it:
 * what a running turn needs to be stopped, steered and asked. Whether a turn
 * runs is the ledger's to say; every change here goes through it.
 */
export class ActiveTurns {
  private turns = new Map<string, ActiveChat>();
  /** By `chatId:rootId`. */
  private sides = new Map<string, Side>();
  /** Turns an agent started by itself while another held the thread. */
  private riders = new Map<string, Set<ActiveChat>>();
  /** Every turn this holds, by its ledger id. */
  private handles = new Map<string, ActiveChat>();
  /** Turns that serve one of these, such as a handoff note. */
  private helpers = new Set<string>();
  /** Turns whose job settled since the last sweep, and those still held at it. */
  private settled = new Set<ActiveChat>();
  private unreleased = new Set<ActiveChat>();
  constructor(
    private changed: (id: string) => void,
    readonly ledger = new TurnLedger(new MemoryTurnStore()),
  ) {}

  get(id: string) {
    return this.turns.get(id);
  }
  has(id: string) {
    return this.turns.has(id);
  }
  ids() {
    return [...this.turns.keys()];
  }
  /** Threads with a turn at work, a turn the agent started beside another included. */
  working() {
    return [...new Set([...this.turns.keys(), ...this.riders.keys()])];
  }
  all() {
    return [...this.turns.values()];
  }
  get size() {
    return this.turns.size;
  }
  requests(id: string) {
    return this.turns.get(id)?.requests.list() ?? [];
  }

  /**
   * A turn that's about to run, with the means to stop it and answer its
   * requests. `rides`: the agent started it beside the thread's running one;
   * it doesn't hold the thread, but stopping the thread stops it too.
   * Whoever creates one releases it.
   */
  create(
    id: string,
    input: ProjectChatSend,
    kind: TurnKind = "answer",
    { rides = false } = {},
  ): ActiveChat {
    const abort = new AbortController();
    let end!: () => void;
    const ended = new Promise<void>((resolve) => (end = resolve));
    const turn = this.ledger.start({
      threadId: id,
      kind,
      provider: sentAgent(input),
    });
    const requests: AgentRequests = new AgentRequests(abort.signal, () => {
      this.ledger.blocked(turn.id, requests.list().length > 0);
      this.changed(id);
    });
    const active: ActiveChat = {
      turnId: turn.id,
      abort,
      input,
      requests,
      ended,
      end,
    };
    this.handles.set(turn.id, active);
    if (rides) {
      const riders = this.riders.get(id) ?? new Set();
      riders.add(active);
      this.riders.set(id, riders);
      this.changed(id);
    }
    return active;
  }

  /** Claims the thread's one running turn. */
  claim(id: string, input: ProjectChatSend, kind: TurnKind = "answer") {
    if (this.turns.has(id))
      throw new Error("This chat already has a running answer.");
    const active = this.create(id, input, kind);
    this.turns.set(id, active);
    this.changed(id);
    return active;
  }

  /** The turn `abort` stops, if this holds it. */
  of(abort: AbortController) {
    for (const active of this.handles.values())
      if (active.abort === abort) return active;
  }
  /** The turn by its ledger id, if this holds it. */
  handle(turnId: string) {
    return this.handles.get(turnId);
  }

  /**
   * `job` is the turn's work, released in its own `finally`: one that settles
   * with the turn still held leaked it, and `sweep` gives the thread back.
   */
  runs(active: ActiveChat, job: Promise<unknown>) {
    active.job = job;
    void job
      .catch(() => {})
      .then(() => {
        if (this.handles.get(active.turnId) === active)
          this.settled.add(active);
      });
    return job;
  }
  /**
   * Ends the turns nothing will release: a job that settled a sweep ago with
   * its turn still held, and a turn open in the ledger that nothing holds.
   * Says which threads changed.
   */
  sweep() {
    const threads = new Set<string>();
    for (const active of this.unreleased) {
      const turn = this.ledger.get(active.turnId);
      if (!turn || this.handles.get(active.turnId) !== active) continue;
      console.warn(
        `A ${turn.kind} turn in thread ${turn.threadId} finished without giving the thread back.`,
      );
      this.ledger.end(active.turnId, "lost");
      this.release(turn.threadId, active);
      threads.add(turn.threadId);
    }
    this.unreleased = new Set(
      [...this.settled].filter((a) => this.handles.get(a.turnId) === a),
    );
    this.settled.clear();
    for (const id of this.ledger.check((t) => this.holds(t))) threads.add(id);
    return [...threads];
  }

  /** The turn's agent is at work, writing `answerId`. */
  running(id: string, active: ActiveChat, answerId: string) {
    this.ledger.phase(active.turnId, "running", answerId);
    this.changed(id);
  }
  /** The answer is written; the turn saves before it gives the thread back. */
  finishing(id: string, active: ActiveChat) {
    this.ledger.phase(active.turnId, "finishing");
    this.changed(id);
  }

  /** Stops the thread's answer and the turns riding beside it; they read as stopping until they end. */
  stop(id: string) {
    const running = [this.turns.get(id), ...(this.riders.get(id) ?? [])];
    if (!running.some(Boolean)) return;
    for (const active of running) {
      if (!active) continue;
      this.ledger.phase(active.turnId, "stopping");
      active.abort.abort();
    }
    this.changed(id);
  }

  /**
   * Ends the turn: it asks nothing more, gives the thread back if it held it,
   * and `halt` stops waiting. Ending one twice changes nothing.
   */
  release(id: string, active: ActiveChat) {
    active.requests.close();
    if (this.turns.get(id) === active) this.turns.delete(id);
    const riders = this.riders.get(id);
    if (riders?.delete(active) && !riders.size) this.riders.delete(id);
    this.handles.delete(active.turnId);
    const answer = active.answer?.();
    this.ledger.end(
      active.turnId,
      outcome(answer, active.abort.signal.aborted),
      answer?.id,
    );
    active.end();
    this.changed(id);
  }

  /**
   * A turn whose answer shows as finished or stopped still winds down before
   * it gives the thread back; whatever the user does next waits for that,
   * not refuses. An agent can take a few seconds to stop.
   */
  async finished(id: string) {
    const active = this.turns.get(id);
    if (active && this.windingDown(active))
      await withTimeout(
        active.ended,
        this.stopping(active) ? 30_000 : 10_000,
        "",
      ).catch(() => {});
  }
  /** Stopped: the answer already shows it, while the agent winds down. */
  stopping(active: ActiveChat) {
    return this.ledger.get(active.turnId)?.phase === "stopping";
  }
  /** Its answer shows as finished or stopped; the turn only winds down. */
  windingDown(active: ActiveChat) {
    const phase = this.ledger.get(active.turnId)?.phase;
    return phase === "finishing" || phase === "stopping";
  }

  async assertIdle(id: string) {
    await this.finished(id);
    if (this.turns.has(id))
      throw new Error("Wait for the answer to finish first.");
  }

  /** Stops the thread's answer and side questions, and waits until they have. */
  async halt(id: string) {
    const deadline = Date.now() + 60_000;
    // An agent can start a turn of its own meanwhile; that one stops too.
    for (;;) {
      const active = this.turns.get(id);
      const riders = [...(this.riders.get(id) ?? [])];
      const sides = [...this.sides]
        .filter(([key]) => key.startsWith(`${id}:`))
        .map(([, side]) => side);
      if (!active && !riders.length && !sides.length) return;
      active?.abort.abort();
      for (const rider of riders) rider.abort.abort();
      for (const side of sides) side.abort.abort();
      try {
        await withTimeout(
          Promise.allSettled([
            active?.ended,
            ...riders.map((r) => r.ended),
            ...sides.map((s) => s.job),
          ]),
          Math.max(0, deadline - Date.now()),
          "The agent didn't stop in time. Try again.",
        );
      } catch (e) {
        if (this.turns.has(id) || this.riders.has(id)) throw e;
        return;
      }
    }
  }

  sideRunning(key: string) {
    return this.sides.has(key);
  }
  /** A side question is being answered in the thread. */
  hasSide(id: string) {
    return [...this.sides.keys()].some((key) => key.startsWith(`${id}:`));
  }
  /** A side question's `answer`, running until `job` settles. */
  runSide(
    key: string,
    provider: AgentProvider,
    answer: ChatMessage,
    abort: AbortController,
    job: Promise<unknown>,
  ) {
    const turn = this.ledger.start({
      threadId: key.slice(0, key.indexOf(":")),
      kind: "aside",
      provider,
    });
    this.ledger.phase(turn.id, "running", answer.id);
    this.sides.set(key, { turnId: turn.id, abort, job, answer });
  }
  sideDone(key: string) {
    const side = this.sides.get(key);
    if (!side) return;
    this.sides.delete(key);
    this.ledger.end(
      side.turnId,
      outcome(side.answer, side.abort.signal.aborted),
      side.answer.id,
    );
  }
  /**
   * A turn that serves `parent` and writes `answer`, such as the outgoing
   * agent's handoff note. Call what this returns when it's done.
   */
  helper(
    threadId: string,
    parent: ActiveChat,
    kind: TurnKind,
    provider: AgentProvider,
    answer: ChatMessage,
  ) {
    const turn = this.ledger.start({
      threadId,
      kind,
      provider,
      parentTurnId: parent.turnId,
    });
    this.ledger.phase(turn.id, "running", answer.id);
    this.helpers.add(turn.id);
    return (stopped: boolean) => {
      this.helpers.delete(turn.id);
      this.ledger.end(turn.id, outcome(answer, stopped), answer.id);
    };
  }
  private holds(turnId: string) {
    return (
      this.handles.has(turnId) ||
      this.helpers.has(turnId) ||
      [...this.sides.values()].some((s) => s.turnId === turnId)
    );
  }
  allSides() {
    return [...this.sides.values()];
  }
}
