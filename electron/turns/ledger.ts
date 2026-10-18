import { randomUUID } from "node:crypto";
import { uptime } from "node:os";
import type {
  Turn,
  TurnEnd,
  TurnEvent,
  TurnKind,
  TurnPhase,
} from "../../shared/turns";
import type { AgentProvider } from "../../shared/agents";
import {
  MemoryTurnStore,
  openTurnStore,
  type Owner,
  type OwnedTurn,
  type TurnStore,
} from "./store";

/** Ledgers open in this process; a turn whose owner is one of them isn't left over. */
const liveOwners = new Set<string>();

/** When this computer started; clock corrections move it a little. */
const bootedAt = () => Math.round(Date.now() - uptime() * 1000);
const SAME_BOOT_MS = 5 * 60_000;

function ownerAlive({ id, pid, boot }: Owner) {
  if (pid === process.pid) return liveOwners.has(id);
  // From before the computer restarted: whatever has its pid now isn't that Relay.
  if (boot !== undefined && Math.abs(boot - bootedAt()) > SAME_BOOT_MS)
    return false;
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
  parentTurnId?: string;
}

/** The ledger on the database in `path`; one that can't be read keeps turns in memory. */
export function openTurnLedger(path: string) {
  const store = openTurnStore(path);
  try {
    return new TurnLedger(store);
  } catch (e) {
    store.close();
    console.warn("Could not read the turn ledger; keeping turns in memory:", e);
    return new TurnLedger(new MemoryTurnStore());
  }
}

/**
 * Every turn in every thread, and the one way to start, move or end one; see
 * docs/turn-lifecycle.md. A turn that ended stays ended: a late word about it
 * changes nothing.
 */
export class TurnLedger {
  private owner: Owner = {
    id: randomUUID(),
    pid: process.pid,
    boot: bootedAt(),
  };
  private open = new Map<string, Turn>();
  /** Turns a Relay that's gone left open; recovered once reattaching is done. */
  private leftOver: OwnedTurn[];
  private listeners = new Set<(event: TurnEvent) => void>();
  private closed = false;

  constructor(private store: TurnStore) {
    this.leftOver = store.open().filter((t) => !ownerAlive(t.owner));
    liveOwners.add(this.owner.id);
  }

  start(input: OpenTurnInput): Turn {
    const turn: Turn = {
      id: randomUUID(),
      threadId: input.threadId,
      kind: input.kind,
      provider: input.provider,
      phase: "starting",
      startedAt: Date.now(),
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

  /** Its agent asked you something and waits, or no longer does. */
  blocked(id: string, waits: boolean) {
    const turn = this.open.get(id);
    if (!turn || !!turn.blocked === waits) return;
    if (waits) turn.blocked = true;
    else delete turn.blocked;
    this.write("blocked", turn);
  }

  end(id: string, endedAs: TurnEnd, answerId?: string) {
    const turn = this.open.get(id);
    if (!turn) return;
    this.open.delete(id);
    turn.phase = "ended";
    turn.endedAs = endedAs;
    turn.endedAt = Date.now();
    if (answerId) turn.answerId = answerId;
    this.write("ended", turn);
  }

  get(id: string): Turn | undefined {
    return this.open.get(id);
  }
  /** The thread's open turns, oldest first. */
  inThread(threadId: string): Turn[] {
    return [...this.open.values()].filter((t) => t.threadId === threadId);
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
    for (const { owner: _, ...turn } of left)
      this.write("ended", {
        ...turn,
        phase: "ended",
        endedAs: "interrupted",
        endedAt: Date.now(),
      });
  }

  /**
   * Ends this Relay's open turns that `alive` no longer knows: they ended
   * without saying. Says which threads that changed.
   */
  check(alive: (turnId: string) => boolean) {
    const threads = new Set<string>();
    for (const turn of [...this.open.values()])
      if (!alive(turn.id)) {
        console.warn(
          `A ${turn.kind} turn in thread ${turn.threadId} ended without the ledger hearing of it.`,
        );
        this.end(turn.id, "lost");
        threads.add(turn.threadId);
      }
    return [...threads];
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
    let seq = -1;
    if (!this.closed)
      try {
        seq = this.store.write(type, turn, this.owner);
      } catch (e) {
        // A turn still runs if its record can't be saved; it just won't survive a restart.
        console.warn("Could not save the turn:", e);
      }
    const event: TurnEvent = { seq, at: Date.now(), type, turn };
    for (const listener of this.listeners)
      try {
        listener(structuredClone(event));
      } catch (e) {
        // What hears of turns never holds up the turn itself.
        console.warn("A turn listener failed:", e);
      }
  }
}
