import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Turn, TurnEvent } from "../../shared/turns";

/** The Relay process that opened a turn: only its own turns are its to end. */
export interface Owner {
  id: string;
  pid: number;
}
export type OwnedTurn = Turn & { owner: Owner };

/** Where the ledger keeps turns and their events. */
export interface TurnStore {
  /** Saves the turn as it now stands and what happened to it, together. */
  write(type: TurnEvent["type"], turn: Turn, owner: Owner): TurnEvent;
  /** Turns that haven't ended, whoever opened them. */
  open(): OwnedTurn[];
  /** Each thread's last turn to end. */
  lastEnded(): Turn[];
  /** Events after `seq`; undefined when some of them are gone. */
  after(seq: number): TurnEvent[] | undefined;
  /** The newest event's number. */
  seq(): number;
  close(): void;
}

/** Events kept for a client catching up; one further behind gets a snapshot. */
const KEEP_EVENTS = 20_000;
const PRUNE_EVERY = 500;

/**
 * The ledger's database in `path`, or turns in memory when this Node has no
 * `node:sqlite` (older than 22.13 without its flag) or the file won't open.
 */
export function openTurnStore(path: string | undefined): TurnStore {
  if (!path) return new MemoryTurnStore();
  try {
    // Looked up here so a Node without it still runs, minus the persistence.
    const sqlite = process.getBuiltinModule("node:sqlite");
    if (!sqlite) throw new Error("This Node has no node:sqlite.");
    mkdirSync(dirname(path), { recursive: true });
    return new SqliteTurnStore(new sqlite.DatabaseSync(path));
  } catch (e) {
    console.warn(
      "Keeping turns in memory; they won't be picked up after a restart:",
      e,
    );
    return new MemoryTurnStore();
  }
}

class SqliteTurnStore implements TurnStore {
  private writes = 0;
  private statements;
  constructor(private db: DatabaseSync) {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        ended_at INTEGER,
        owner TEXT NOT NULL,
        pid INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS turns_open ON turns (phase) WHERE phase != 'ended';
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    this.statements = {
      turn: db.prepare(`
        INSERT INTO turns (id, thread_id, phase, ended_at, owner, pid, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          phase = excluded.phase, ended_at = excluded.ended_at, data = excluded.data`),
      event: db.prepare(
        "INSERT INTO events (at, type, turn_id, data) VALUES (?, ?, ?, ?)",
      ),
      // A thread keeps only its last ended turn; the events keep the rest.
      forget: db.prepare(
        "DELETE FROM turns WHERE thread_id = ? AND phase = 'ended' AND id != ?",
      ),
      prune: db.prepare("DELETE FROM events WHERE seq <= ?"),
      open: db.prepare(
        "SELECT owner, pid, data FROM turns WHERE phase != 'ended'",
      ),
      ended: db.prepare("SELECT data FROM turns WHERE phase = 'ended'"),
      after: db.prepare(
        "SELECT seq, at, type, data FROM events WHERE seq > ? ORDER BY seq",
      ),
      bounds: db.prepare(
        "SELECT MIN(seq) AS first, MAX(seq) AS last FROM events",
      ),
    };
  }
  write(type: TurnEvent["type"], turn: Turn, owner: Owner): TurnEvent {
    const at = Date.now();
    const data = JSON.stringify(turn);
    const s = this.statements;
    this.db.exec("BEGIN");
    try {
      s.turn.run(
        turn.id,
        turn.threadId,
        turn.phase,
        turn.endedAt ?? null,
        owner.id,
        owner.pid,
        data,
      );
      if (turn.phase === "ended") s.forget.run(turn.threadId, turn.id);
      const { lastInsertRowid } = s.event.run(at, type, turn.id, data);
      if (++this.writes % PRUNE_EVERY === 0)
        s.prune.run(Number(lastInsertRowid) - KEEP_EVENTS);
      this.db.exec("COMMIT");
      return { seq: Number(lastInsertRowid), at, type, turn };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  open() {
    return (
      this.statements.open.all() as { owner: string; pid: number; data: string }[]
    ).map(({ owner, pid, data }) => ({
      ...(JSON.parse(data) as Turn),
      owner: { id: owner, pid },
    }));
  }
  lastEnded() {
    return (this.statements.ended.all() as { data: string }[]).map(
      ({ data }) => JSON.parse(data) as Turn,
    );
  }
  after(seq: number) {
    const { first, last } = this.statements.bounds.get() as {
      first: number | null;
      last: number | null;
    };
    if (last === null) return seq === 0 ? [] : undefined;
    // Pruned past it, or a number from before this database.
    if (seq < first! - 1 || seq > last) return undefined;
    return (
      this.statements.after.all(seq) as {
        seq: number;
        at: number;
        type: TurnEvent["type"];
        data: string;
      }[]
    ).map(({ data, ...event }) => ({ ...event, turn: JSON.parse(data) }));
  }
  seq() {
    return (this.statements.bounds.get() as { last: number | null }).last ?? 0;
  }
  close() {
    this.db.close();
  }
}

export class MemoryTurnStore implements TurnStore {
  private turns = new Map<string, OwnedTurn>();
  private events: TurnEvent[] = [];
  private last = 0;
  write(type: TurnEvent["type"], turn: Turn, owner: Owner): TurnEvent {
    this.turns.set(turn.id, { ...turn, owner });
    if (turn.phase === "ended")
      for (const [id, t] of this.turns)
        if (t.threadId === turn.threadId && t.phase === "ended" && id !== turn.id)
          this.turns.delete(id);
    const event = { seq: ++this.last, at: Date.now(), type, turn };
    this.events.push(event);
    if (this.events.length > KEEP_EVENTS) this.events.shift();
    return event;
  }
  open() {
    return [...this.turns.values()].filter((t) => t.phase !== "ended");
  }
  lastEnded() {
    return [...this.turns.values()].filter((t) => t.phase === "ended");
  }
  after(seq: number) {
    const first = this.events[0]?.seq ?? this.last + 1;
    if (seq < first - 1 || seq > this.last) return undefined;
    return this.events.filter((e) => e.seq > seq);
  }
  seq() {
    return this.last;
  }
  close() {}
}
