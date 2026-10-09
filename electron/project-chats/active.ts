import type { HtmlRender } from "../../shared/html-render";
import type { ProjectChatSend } from "../../shared/projects";
import { AgentRequests } from "./agent-requests";
import type { AgentOptions } from "../agents/types";
import { withTimeout } from "../util/timeout";

export type AgentControl = Parameters<
  NonNullable<AgentOptions["onControl"]>
>[0];

export interface ActiveChat {
  started: number;
  requests: AgentRequests;
  abort: AbortController;
  job?: Promise<unknown>;
  input?: ProjectChatSend;
  steer?: AgentControl["steer"];
  /** Adds a page the agent showed to the answer it is writing. */
  render?: (render: HtmlRender) => void;
  /** Counts the rest of the answer's edits in the worktree the thread just moved to. */
  moved?: (root: string) => Promise<void>;
  /** Pauses or clears the goal the turn pursues; Codex only. */
  goal?: AgentControl["goal"];
  /** Settles once the turn gives the thread back; see `release`. */
  ended: Promise<void>;
  /** The answer is written; the turn only saves before giving the thread back. */
  finishing?: boolean;
  /** Stopped: the answer already shows it, while the agent winds down. */
  stopping?: boolean;
  end: () => void;
}

interface Side {
  abort: AbortController;
  job: Promise<unknown>;
}

/** Each thread's one running turn, and the side questions answered beside it. */
export class ActiveTurns {
  private turns = new Map<string, ActiveChat>();
  /** By `chatId:rootId`. */
  private sides = new Map<string, Side>();
  constructor(private changed: (id: string) => void) {}

  get(id: string) {
    return this.turns.get(id);
  }
  has(id: string) {
    return this.turns.has(id);
  }
  ids() {
    return [...this.turns.keys()];
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

  /** A turn that's about to run, with the means to stop it and answer its requests. */
  create(id: string, input: ProjectChatSend): ActiveChat {
    const abort = new AbortController();
    let end!: () => void;
    const ended = new Promise<void>((resolve) => (end = resolve));
    return {
      started: Date.now(),
      abort,
      input,
      requests: new AgentRequests(abort.signal, () => this.changed(id)),
      ended,
      end,
    };
  }

  /** Claims the thread's one running turn. */
  claim(id: string, input: ProjectChatSend) {
    if (this.turns.has(id))
      throw new Error("This chat already has a running answer.");
    const active = this.create(id, input);
    this.turns.set(id, active);
    this.changed(id);
    return active;
  }

  /** Stops the thread's answer; the thread reads as idle while the agent winds down. */
  stop(id: string) {
    const active = this.turns.get(id);
    if (!active) return;
    active.stopping = true;
    active.abort.abort();
    this.changed(id);
  }

  /** Gives the thread back: the turn asks nothing more, and `halt` stops waiting. */
  release(id: string, active: ActiveChat) {
    active.requests.close();
    if (this.turns.get(id) === active) this.turns.delete(id);
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
    if (active?.finishing || active?.stopping)
      await withTimeout(
        active.ended,
        active.stopping ? 30_000 : 10_000,
        "",
      ).catch(() => {});
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
      const sides = [...this.sides]
        .filter(([key]) => key.startsWith(`${id}:`))
        .map(([, side]) => side);
      if (!active && !sides.length) return;
      active?.abort.abort();
      for (const side of sides) side.abort.abort();
      try {
        await withTimeout(
          Promise.allSettled([active?.ended, ...sides.map((s) => s.job)]),
          Math.max(0, deadline - Date.now()),
          "The agent didn't stop in time. Try again.",
        );
      } catch (e) {
        if (this.turns.has(id)) throw e;
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
  /** A side question's answer, running until `job` settles. */
  runSide(key: string, abort: AbortController, job: Promise<unknown>) {
    this.sides.set(key, { abort, job });
  }
  sideDone(key: string) {
    this.sides.delete(key);
  }
  allSides() {
    return [...this.sides.values()];
  }
}
