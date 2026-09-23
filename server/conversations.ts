import { z } from "zod";
import { idSchema } from "../shared/rooms";
import { chatScopeSchema, type ChatMessage } from "../shared/projects";
import { RoomsDatabase, HttpError, type Session } from "./database";
const sharedMessage = z
  .object({
    id: idSchema,
    role: z.enum(["user", "assistant"]),
    body: z.string().max(100000),
    status: z.enum(["complete", "failed", "cancelled"]),
    created: z.number().int().nonnegative(),
    provider: z.enum(["codex", "claude"]),
    error: z.string().max(1000).optional(),
    version: z.number().int().positive(),
    parentId: idSchema.nullable().optional(),
  })
  .strict();
export const shareConversationSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(120),
    scope: chatScopeSchema,
    messages: z.array(sharedMessage).max(1000),
  })
  .strict();
export const sharedMessagesSchema = z
  .object({ messages: z.array(sharedMessage).min(1).max(1000) })
  .strict();
type Row = Record<string, any>;
export class Conversations {
  constructor(private database: RoomsDatabase) {
    const db = database.db;
    if (
      !(db.prepare("PRAGMA table_info(rooms)").all() as Row[]).some(
        (r) => r.name === "chat_key",
      )
    ) {
      // SQLite's documented table-rebuild migration preserves room IDs and every
      // referencing message/workspace row. The server has not begun listening.
      db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
      try {
        db.exec(`CREATE TABLE rooms_next(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),number INTEGER,title TEXT NOT NULL,chat_key TEXT UNIQUE);
        INSERT INTO rooms_next(id,project_id,number,title) SELECT id,project_id,number,title FROM rooms;
        DROP TABLE rooms; ALTER TABLE rooms_next RENAME TO rooms;
        CREATE UNIQUE INDEX rooms_pr ON rooms(project_id,number) WHERE chat_key IS NULL AND number IS NOT NULL;`);
        if (db.prepare("PRAGMA foreign_key_check").all().length)
          throw new Error("Room migration failed its relationship check.");
        db.exec("COMMIT;");
      } catch (e) {
        db.exec("ROLLBACK;");
        throw e;
      } finally {
        db.exec("PRAGMA foreign_keys=ON;");
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS conversations(room_id TEXT PRIMARY KEY REFERENCES rooms(id),owner_id TEXT NOT NULL REFERENCES members(id),scope TEXT NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_messages(room_id TEXT NOT NULL REFERENCES rooms(id),id TEXT NOT NULL,author_id TEXT NOT NULL REFERENCES members(id),seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(room_id,id));
      CREATE INDEX IF NOT EXISTS conversation_message_sequence ON conversation_messages(room_id,seq);`);
  }
  private meta(s: Session, id: string) {
    this.database.room(s, id);
    const row = this.database.db
      .prepare(
        "SELECT r.id,r.title,c.scope,c.updated,c.owner_id FROM rooms r JOIN conversations c ON c.room_id=r.id WHERE r.id=?",
      )
      .get(id) as Row | undefined;
    if (!row) throw new HttpError(404, "Conversation not found.");
    return {
      id: row.id,
      title: row.title,
      scope: JSON.parse(row.scope),
      updated: row.updated,
      ownerId: row.owner_id,
    };
  }
  list(s: Session) {
    return (
      this.database.db
        .prepare(
          "SELECT r.id FROM rooms r JOIN conversations c ON c.room_id=r.id WHERE r.project_id=? ORDER BY c.updated DESC LIMIT 500",
        )
        .all(s.projectId) as Row[]
    ).map((r) => this.meta(s, r.id));
  }
  share(s: Session, input: z.infer<typeof shareConversationSchema>) {
    const project = this.database.project(s.projectId);
    if (
      input.scope.kind === "pr" &&
      (input.scope.ref.owner !== project.owner ||
        input.scope.ref.name !== project.name)
    )
      throw new HttpError(409, "This PR belongs to another project.");
    return this.database.transaction(() => {
      const old = this.database.db
        .prepare("SELECT owner_id FROM conversations WHERE room_id=?")
        .get(input.id) as Row | undefined;
      if (old) {
        this.database.room(s, input.id);
        if (old.owner_id !== s.id)
          throw new HttpError(
            403,
            "Only the original author can import this private conversation.",
          );
      } else {
        if (
          this.database.db
            .prepare("SELECT id FROM rooms WHERE id=?")
            .get(input.id)
        )
          throw new HttpError(409, "Conversation identity is already in use.");
        this.database.db
          .prepare(
            "INSERT INTO rooms(id,project_id,number,title,chat_key) VALUES(?,?,?,?,?)",
          )
          .run(
            input.id,
            s.projectId,
            input.scope.kind === "pr" ? input.scope.ref.number : null,
            input.title,
            input.id,
          );
        this.database.db
          .prepare("INSERT INTO conversations VALUES(?,?,?,?)")
          .run(input.id, s.id, JSON.stringify(input.scope), Date.now());
      }
      this.insert(s, input.id, input.messages);
      return this.meta(s, input.id);
    });
  }
  post(s: Session, id: string, input: z.infer<typeof sharedMessagesSchema>) {
    this.meta(s, id);
    return this.database.transaction(() => this.insert(s, id, input.messages));
  }
  private insert(
    s: Session,
    roomId: string,
    messages: z.infer<typeof sharedMessagesSchema>["messages"],
  ) {
    const db = this.database.db,
      output: ChatMessage[] = [];
    for (const message of messages) {
      const old = db
        .prepare(
          "SELECT data,author_id FROM conversation_messages WHERE room_id=? AND id=?",
        )
        .get(roomId, message.id) as Row | undefined;
      if (old) {
        const m = JSON.parse(old.data);
        if (
          old.author_id !== s.id ||
          m.body !== message.body ||
          m.status !== message.status ||
          m.role !== message.role ||
          m.provider !== message.provider ||
          (m.parentId ?? null) !== (message.parentId ?? null)
        )
          throw new HttpError(
            409,
            "This message was already shared with different contents.",
          );
        output.push(m);
        continue;
      }
      if (
        message.parentId &&
        !db
          .prepare(
            "SELECT id FROM conversation_messages WHERE room_id=? AND id=?",
          )
          .get(roomId, message.parentId)
      )
        throw new HttpError(
          409,
          "Reply target is missing from this conversation.",
        );
      const seq = this.database.seq(),
        m = { ...message, author: s.name, authorId: s.id, seq };
      db.prepare("INSERT INTO conversation_messages VALUES(?,?,?,?,?)").run(
        roomId,
        m.id,
        s.id,
        seq,
        JSON.stringify(m),
      );
      output.push(m);
    }
    db.prepare("UPDATE conversations SET updated=? WHERE room_id=?").run(
      Date.now(),
      roomId,
    );
    return output;
  }
  poll(s: Session, id: string, after: number) {
    const conversation = this.meta(s, id);
    const rows = this.database.db
      .prepare(
        "SELECT seq,data FROM conversation_messages WHERE room_id=? AND seq>? ORDER BY seq LIMIT 200",
      )
      .all(id, after) as Row[];
    return {
      conversation,
      messages: rows.map((r) => JSON.parse(r.data)),
      next: rows.at(-1)?.seq ?? after,
      more: rows.length === 200,
    };
  }
}
