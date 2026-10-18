import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Turn, TurnEvent } from "../../shared/turns";

/** The Relay process that opened a turn: only its own turns are its to end. */
export interface Owner {
  id: string;
  pid: number;
  /** When its computer started, so a pid reused after a restart isn't taken for it. */
  boot?: number;
}
export type OwnedTurn = Turn & { owner: Owner };

/** Where the ledger keeps the turns still open and what happened to every turn. */
export interface TurnStore {
  /**
   * Saves the turn as it now stands and what happened to it, together, and
   * says the event's number. An ended turn leaves only its events behind.
   */
  write(type: TurnEvent["type"], turn: Turn, owner: Owner): number;
  /** Turns that haven't ended, whoever opened them. */
  open(): OwnedTurn[];
  close(): void;
}

/** Events kept to look back on; older ones go. */
const KEEP_EVENTS = 20_000;
const PRUNE_EVERY = 500;

/**
 * The ledger's database in `path`, or turns in memory when this Node has no
 * `node:sqlite` (older than 22.13 without its flag) or the file won't open.
 */
export function openTurnStore(path: string | undefined): TurnStore {
  if (!path) return new MemoryTurnStore();
  let db: DatabaseSync | undefined;
  try {
    // Looked up here so a Node without it still runs, minus the persistence.
    const sqlite = process.getBuiltinModule("node:sqlite");
    if (!sqlite) throw new Error("This Node has no node:sqlite.");
    mkdirSync(dirname(path), { recursive: true });
    db = new sqlite.DatabaseSync(path);
    return new SqliteTurnStore(db);
  } catch (e) {
    // Held open, the file would stay locked on Windows.
    db?.close();
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
        owner TEXT NOT NULL,
        pid INTEGER NOT NULL,
        data TEXT NOT NULL,
        boot INTEGER
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    const columns = db.prepare("PRAGMA table_info(turns)").all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "boot"))
      db.exec("ALTER TABLE turns ADD COLUMN boot INTEGER");
    this.statements = {
      turn: db.prepare(`
        INSERT INTO turns (id, owner, pid, boot, data) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET data = excluded.data`),
      ended: db.prepare("DELETE FROM turns WHERE id = ?"),
      event: db.prepare(
        "INSERT INTO events (at, type, turn_id, data) VALUES (?, ?, ?, ?)",
      ),
      prune: db.prepare("DELETE FROM events WHERE seq <= ?"),
      open: db.prepare("SELECT owner, pid, boot, data FROM turns"),
    };
  }
  write(type: TurnEvent["type"], turn: Turn, owner: Owner) {
    const data = JSON.stringify(turn);
    const s = this.statements;
    this.db.exec("BEGIN");
    try {
      if (turn.phase === "ended") s.ended.run(turn.id);
      else s.turn.run(turn.id, owner.id, owner.pid, owner.boot ?? null, data);
      const { lastInsertRowid } = s.event.run(Date.now(), type, turn.id, data);
      const seq = Number(lastInsertRowid);
      if (++this.writes % PRUNE_EVERY === 0) s.prune.run(seq - KEEP_EVENTS);
      this.db.exec("COMMIT");
      return seq;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  open() {
    return (
      this.statements.open.all() as {
        owner: string;
        pid: number;
        boot: number | null;
        data: string;
      }[]
    ).map(({ owner, pid, boot, data }) => ({
      ...(JSON.parse(data) as Turn),
      owner: { id: owner, pid, ...(boot === null ? {} : { boot }) },
    }));
  }
  close() {
    this.db.close();
  }
}

export class MemoryTurnStore implements TurnStore {
  private turns = new Map<string, OwnedTurn>();
  private seq = 0;
  write(_type: TurnEvent["type"], turn: Turn, owner: Owner) {
    if (turn.phase === "ended") this.turns.delete(turn.id);
    else this.turns.set(turn.id, { ...structuredClone(turn), owner });
    return ++this.seq;
  }
  open() {
    return [...this.turns.values()].map((t) => structuredClone(t));
  }
  close() {}
}
