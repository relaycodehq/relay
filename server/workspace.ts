import { RoomsDatabase, HttpError, hash, type Session } from "./database";
import {
  syncWriteSchema,
  type SyncManifest,
  type SyncDocument,
  type SyncFile,
} from "../shared/live-sync";
import { shaSchema } from "../shared/validation";
import { workingPathSchema } from "../shared/working-tree";
type Row = Record<string, any>;
export class SharedWorkspace {
  constructor(private database: RoomsDatabase) {
    database.db
      .exec(`CREATE TABLE IF NOT EXISTS workspaces(room_id TEXT PRIMARY KEY REFERENCES rooms(id),base TEXT NOT NULL,seq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS working_files(room_id TEXT NOT NULL REFERENCES workspaces(room_id),path TEXT NOT NULL,revision INTEGER NOT NULL,hash TEXT,mode INTEGER,author TEXT NOT NULL,updated INTEGER NOT NULL,contents TEXT,PRIMARY KEY(room_id,path));`);
  }
  open(s: Session, room: string, base: string): SyncManifest {
    this.database.room(s, room);
    shaSchema.parse(base);
    this.database.db
      .prepare("INSERT OR IGNORE INTO workspaces(room_id,base) VALUES(?,?)")
      .run(room, base);
    return this.manifest(s, room);
  }
  manifest(s: Session, room: string): SyncManifest {
    this.database.room(s, room);
    const row = this.database.db
      .prepare("SELECT base FROM workspaces WHERE room_id=?")
      .get(room) as Row | undefined;
    if (!row)
      throw new HttpError(
        404,
        "Live sync has not been started for this PR room.",
      );
    const files = this.database.db
      .prepare(
        "SELECT path,revision,hash,mode,author,updated FROM working_files WHERE room_id=? ORDER BY path",
      )
      .all(room) as unknown as SyncFile[];
    return { base: row.base, files };
  }
  read(s: Session, room: string, path: string): SyncDocument {
    this.database.room(s, room);
    workingPathSchema.parse(path);
    const row = this.database.db
      .prepare("SELECT * FROM working_files WHERE room_id=? AND path=?")
      .get(room, path) as Row | undefined;
    if (!row) throw new HttpError(404, "Shared file not found.");
    return {
      path: row.path,
      revision: row.revision,
      hash: row.hash,
      mode: row.mode,
      author: row.author,
      updated: row.updated,
      value:
        row.contents === null
          ? null
          : { contents: row.contents, mode: row.mode },
    };
  }
  write(s: Session, room: string, input: unknown): SyncDocument {
    this.database.room(s, room);
    const { path, expected, value } = syncWriteSchema.parse(input);
    if (
      value &&
      (Buffer.byteLength(value.contents) > 2 * 1024 * 1024 ||
        value.contents.includes("\0") ||
        value.contents.startsWith("version https://git-lfs.github.com/spec/v1"))
    )
      throw new HttpError(
        413,
        "Only UTF-8 text files up to 2 MiB can be shared.",
      );
    const db = this.database.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const workspace = db
        .prepare("SELECT seq FROM workspaces WHERE room_id=?")
        .get(room) as Row | undefined;
      if (!workspace) throw new HttpError(409, "Start live sync first.");
      const old = db
        .prepare(
          "SELECT revision,length(CAST(contents AS BLOB)) AS size FROM working_files WHERE room_id=? AND path=?",
        )
        .get(room, path) as Row | undefined;
      if ((old?.revision ?? 0) !== expected)
        throw new HttpError(
          409,
          "A colleague changed this file. Refresh and resolve the conflict.",
        );
      const usage = db
        .prepare(
          "SELECT count(*) AS count,coalesce(sum(length(CAST(contents AS BLOB))),0) AS size FROM working_files WHERE room_id=?",
        )
        .get(room) as Row;
      if (
        (!old && usage.count >= 2000) ||
        usage.size -
          (old?.size ?? 0) +
          (value ? Buffer.byteLength(value.contents) : 0) >
          64 * 1024 * 1024
      )
        throw new HttpError(
          413,
          "Shared workspace limit reached (2,000 files / 64 MiB of changed text). Commit and start a new PR room for more changes.",
        );
      const revision = Number(workspace.seq) + 1;
      db.prepare("UPDATE workspaces SET seq=? WHERE room_id=?").run(
        revision,
        room,
      );
      db.prepare(
        "INSERT INTO working_files VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(room_id,path) DO UPDATE SET revision=excluded.revision,hash=excluded.hash,mode=excluded.mode,author=excluded.author,updated=excluded.updated,contents=excluded.contents",
      ).run(
        room,
        path,
        revision,
        value ? hash(value.contents) : null,
        value?.mode ?? null,
        s.name,
        Date.now(),
        value?.contents ?? null,
      );
      db.exec("COMMIT");
      return this.read(s, room, path);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
