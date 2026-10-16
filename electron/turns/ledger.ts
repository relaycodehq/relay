import { randomUUID } from "node:crypto";
import type {
  Turn,
  TurnEnd,
  TurnEvent,
  TurnKind,
  TurnPhase,
} from "../../shared/turns";
import type { AgentProvider } from "../../shared/agents";
import type { Owner, OwnedTurn, TurnStore } from "./store";

/** Ledgers open in this process; a turn whose owner is one of them isn't left over. */
const liveOwners = new Set<string>();

function ownerAlive({ id, pid }: Owner) {
  if (pid === process.pid) return liveOwners.has(id);
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Alive, only not ours to signal.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface OpenTurnInput {
  threadId: string;
  kind: TurnKind;
  provider: AgentProvider;
  rides?: boolean;
  parentTurnId?: string;
}

/**
 * Every turn in every thread, and the one way to start, move or end one; see
 * docs/turn-lifecycle.md. A turn that ended stays ended: a late word about it
 * changes nothing.
 */
export class TurnLedger {
  private owner: Owner = { id: randomUUID(), pid: process.pid };
  private open = new Map<string, Turn>();
  /** Turns a Relay that's gone left open; recovered once reattaching is done. */
  private leftOver: OwnedTurn[];
  private lastEnded = new Map<string, Turn>();
  private listeners = new Set<(event: TurnEvent) => void>();
  private closed = false;

  constructor(private store: TurnStore) {
    liveOwners.add(this.owner.id);
    this.leftOver = store.open().filter((t) => !ownerAlive(t.owner));
    for (const turn of store.lastEnded()) this.lastEnded.set(turn.threadId, turn);
  }

  start(input: OpenTurnInput): Turn {
    const turn: Turn = {
      id: randomUUID(),
      threadId: input.threadId,
      kind: input.kind,
      provider: input.provider,
      phase: "starting",
      startedAt: Date.now(),
      ...(input.rides ? { rides: true as const } : {}),
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
    };
    this.open.set(turn.id, turn);
    this.write("opened", turn);
    return turn;
  }

  /** Moves an open turn on. Stopping is final until it ends. */
  phase(id: string, phase: Exclude<TurnPhase, "ended">, answerId?: string) {
    const turn = this.open.get(id);
    if (!turn || turn.phase === phase || turn.phase === "stopping") return;
    turn.phase = phase;
    if (answerId) turn.answerId = answerId;
    this.write("phase", turn);
  }

  end(id: string, endedAs: TurnEnd, answerId?: string) {
    const turn = this.open.get(id);
    if (!turn) return;
    this.open.delete(id);
    turn.phase = "ended";
    turn.endedAs = endedAs;
    turn.endedAt = Date.now();
    if (answerId) turn.answerId = answerId;
    this.lastEnded.set(turn.threadId, turn);
    this.write("ended", turn);
  }

  get(id: string): Turn | undefined {
    return this.open.get(id);
  }
  /** The thread's open turns, oldest first. */
  inThread(threadId: string): Turn[] {
    return [...this.open.values()].filter((t) => t.threadId === threadId);
  }
  /** The last turn to end in the thread. */
  lastTurn(threadId: string): Turn | undefined {
    return this.lastEnded.get(threadId);
  }
  /** Events after `seq`, or undefined when a snapshot has to stand in for them. */
  since(seq: number) {
    return this.store.after(seq);
  }
  seq() {
    return this.store.seq();
  }
  onEvent(listener: (event: TurnEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Ends what a Relay that quit left open: whatever the agent host kept going
   * was picked up in a turn of its own by now.
   */
  recover() {
    const left = this.leftOver;
    this.leftOver = [];
    for (const turn of left) {
      const ended: Turn = {
        ...turn,
        phase: "ended",
        endedAs: "interrupted",
        endedAt: Date.now(),
      };
      delete (ended as Partial<OwnedTurn>).owner;
      const last = this.lastEnded.get(turn.threadId);
      if (!last || (last.endedAt ?? 0) <= ended.endedAt!)
        this.lastEnded.set(turn.threadId, ended);
      this.write("ended", ended);
    }
  }

  /** Ends this Relay's open turns that `alive` no longer knows: they ended without saying. */
  check(alive: (turnId: string) => boolean) {
    for (const turn of [...this.open.values()])
      if (!alive(turn.id)) {
        console.warn(
          `A ${turn.kind} turn in thread ${turn.threadId} ended without the ledger hearing of it.`,
        );
        this.end(turn.id, "lost");
      }
  }

  /** A turn that ends after this still ends, only no longer on disk. */
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    liveOwners.delete(this.owner.id);
    this.store.close();
  }

  private write(type: TurnEvent["type"], turn: Turn) {
    let event: TurnEvent = { seq: -1, at: Date.now(), type, turn };
    if (!this.closed)
      try {
        event = this.store.write(type, turn, this.owner);
      } catch (e) {
        // A turn still runs if its record can't be saved; it just won't survive a restart.
        console.warn("Could not save the turn:", e);
      }
    const copy = structuredClone(event);
    for (const listener of this.listeners) listener(copy);
  }
}
