import type { RepositoryIdentity } from "./repository-access";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  roomMention,
  type MessageInput,
  type RoomMessage,
  type RoomProject,
  type Member,
  type Room,
} from "../shared/rooms";

export const token = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface Session {
  id: string;
  projectId: string;
  name: string;
  owner: boolean;
}
type Row = Record<string, any>;
export const DISCONNECTED_RUN =
  "The sender disconnected. Any partial answer was kept. Ask again to retry.";
export class RoomsDatabase {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, owner INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), expires INTEGER NOT NULL, used_by TEXT);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), number INTEGER NOT NULL, title TEXT NOT NULL, UNIQUE(project_id,number));
      CREATE TABLE IF NOT EXISTS repository_identities(member_id TEXT PRIMARY KEY REFERENCES members(id),gitea_id INTEGER NOT NULL,server TEXT NOT NULL,repository_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS clock(id INTEGER PRIMARY KEY CHECK(id=1),seq INTEGER NOT NULL);
      INSERT OR IGNORE INTO clock VALUES(1,0);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),author_id TEXT NOT NULL REFERENCES members(id),ord INTEGER NOT NULL,seq INTEGER NOT NULL,updated INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_room_seq ON messages(room_id,seq);
      CREATE INDEX IF NOT EXISTS messages_room_order ON messages(room_id,ord);
      CREATE INDEX IF NOT EXISTS messages_running ON messages(updated) WHERE json_extract(data,'$.status')='running';
      CREATE TABLE IF NOT EXISTS runs(request_id TEXT PRIMARY KEY REFERENCES messages(id), message_id TEXT NOT NULL UNIQUE REFERENCES messages(id));`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  seq() {
    return Number(
      (
        this.db
          .prepare("UPDATE clock SET seq=seq+1 WHERE id=1 RETURNING seq")
          .get() as Row
      ).seq,
    );
  }
  authenticate(secret: string): Session {
    const row = this.db
      .prepare(
        "SELECT * FROM members WHERE token_hash=? AND revoked=0 AND expires>?",
      )
      .get(hash(secret), Date.now()) as Row | undefined;
    if (!row)
      throw new HttpError(
        401,
        "Room sign-in expired or was revoked. Ask for a new invitation.",
      );
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      owner: !!row.owner,
    };
  }
  bindIdentity(
    session: Session,
    identity: RepositoryIdentity,
    initial = false,
  ) {
    const row = this.db
      .prepare("SELECT * FROM repository_identities WHERE member_id=?")
      .get(session.id) as Row | undefined;
    if (row) {
      if (
        row.gitea_id !== identity.userId ||
        row.server !== identity.server ||
        row.repository_id !== identity.repositoryId
      )
        throw new HttpError(
          403,
          "This room membership belongs to a different Gitea identity or repository.",
        );
      return;
    }
    if (!initial)
      throw new HttpError(
        401,
        "This older membership needs a fresh invitation or project setup to verify its Gitea identity. Your shared history is preserved.",
      );
    this.db
      .prepare("INSERT INTO repository_identities VALUES(?,?,?,?)")
      .run(session.id, identity.userId, identity.server, identity.repositoryId);
  }
  project(id: string): RoomProject {
    const r = this.db
      .prepare("SELECT identity FROM projects WHERE id=?")
      .get(id) as Row | undefined;
    if (!r) throw new HttpError(404, "Project not found.");
    return JSON.parse(r.identity);
  }
  create(project: RoomProject, name: string, sessionToken: string) {
    return this.transaction(() => {
      const identity = JSON.stringify(project);
      const existing = this.db
        .prepare("SELECT id FROM projects WHERE identity=?")
        .get(identity) as Row | undefined;
      if (existing) {
        try {
          const s = this.authenticate(sessionToken);
          if (s.projectId === existing.id && s.owner) return s;
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 401)
            throw error;
        }
        // Only the HTTP setup-key endpoint calls create. Preserve all old content
        // while rotating ownership to a newly verified local account.
        this.db
          .prepare("UPDATE members SET owner=0 WHERE project_id=? AND owner=1")
          .run(existing.id);
        return this.member(existing.id, name, true, sessionToken);
      }
      const id = randomUUID();
      this.db.prepare("INSERT INTO projects VALUES(?,?)").run(id, identity);
      return this.member(id, name, true, sessionToken);
    });
  }
  private member(
    projectId: string,
    name: string,
    owner: boolean,
    sessionToken: string,
  ): Session {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO members(id,project_id,name,owner,token_hash,expires) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        projectId,
        name,
        Number(owner),
        hash(sessionToken),
        Date.now() + 90 * 86400_000,
      );
    return { id, projectId, name, owner };
  }
  invite(s: Session) {
    if (!s.owner)
      throw new HttpError(403, "Only the project owner can invite people.");
    const code = token(),
      expiresAt = Date.now() + 86400_000;
    this.db
      .prepare("INSERT INTO invites VALUES(?,?,?,NULL)")
      .run(hash(code), s.projectId, expiresAt);
    return { code, expiresAt };
  }
  join(projectId: string, code: string, name: string, sessionToken: string) {
    return this.transaction(() => {
      const invite = this.db
        .prepare(
          "SELECT * FROM invites WHERE hash=? AND project_id=? AND expires>?",
        )
        .get(hash(code), projectId, Date.now()) as Row | undefined;
      if (!invite)
        throw new HttpError(403, "Invitation is invalid or expired.");
      if (invite.used_by) {
        const existing = this.authenticate(sessionToken);
        if (existing.id !== invite.used_by)
          throw new HttpError(403, "This invitation was already used.");
        return existing;
      }
      const s = this.member(projectId, name, false, sessionToken);
      this.db
        .prepare("UPDATE invites SET used_by=? WHERE hash=?")
        .run(s.id, hash(code));
      return s;
    });
  }
  members(s: Session): Member[] {
    return (
      this.db
        .prepare(
          "SELECT id,name,owner FROM members WHERE project_id=? AND revoked=0 AND expires>?",
        )
        .all(s.projectId, Date.now()) as Row[]
    ).map((r) => ({ id: r.id, name: r.name, owner: !!r.owner }));
  }
  revoke(s: Session, id: string) {
    if (!s.owner && id !== s.id)
      throw new HttpError(403, "Only the owner can remove a colleague.");
    const r = this.db
      .prepare("SELECT owner FROM members WHERE id=? AND project_id=?")
      .get(id, s.projectId) as Row | undefined;
    if (!r || r.owner)
      throw new HttpError(400, "The project owner cannot be removed.");
    this.db.prepare("UPDATE members SET revoked=1 WHERE id=?").run(id);
  }
  open(s: Session, number: number, title: string): Room {
    const hasChats = (
      this.db.prepare("PRAGMA table_info(rooms)").all() as Row[]
    ).some((r) => r.name === "chat_key");
    const canonical = hasChats ? " AND chat_key IS NULL" : "";
    const existing = this.db
      .prepare(
        "SELECT id FROM rooms WHERE project_id=? AND number=?" + canonical,
      )
      .get(s.projectId, number) as Row | undefined;
    if (existing)
      this.db
        .prepare("UPDATE rooms SET title=? WHERE id=?")
        .run(title, existing.id);
    else
      this.db
        .prepare(
          "INSERT INTO rooms(id,project_id,number,title) VALUES(?,?,?,?)",
        )
        .run(randomUUID(), s.projectId, number, title);
    const r = this.db
      .prepare(
        "SELECT id,number,title FROM rooms WHERE project_id=? AND number=?" +
          canonical,
      )
      .get(s.projectId, number) as Row;
    return { id: r.id, number: r.number, title: r.title };
  }
  room(s: Session, id: string) {
    if (
      !this.db
        .prepare("SELECT id FROM rooms WHERE id=? AND project_id=?")
        .get(id, s.projectId)
    )
      throw new HttpError(404, "Room not found.");
  }
  get(s: Session, roomId: string, id: string): RoomMessage {
    this.room(s, roomId);
    const r = this.db
      .prepare("SELECT data FROM messages WHERE id=? AND room_id=?")
      .get(id, roomId) as Row | undefined;
    if (!r) throw new HttpError(404, "Message not found.");
    return JSON.parse(r.data);
  }
  private put(m: RoomMessage, insert = false) {
    m.seq = this.seq();
    if (insert) m.order = m.seq;
    if (insert)
      this.db
        .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)")
        .run(
          m.id,
          m.roomId,
          m.authorId,
          m.order,
          m.seq,
          Date.now(),
          JSON.stringify(m),
        );
    else
      this.db
        .prepare("UPDATE messages SET seq=?,updated=?,data=? WHERE id=?")
        .run(m.seq, Date.now(), JSON.stringify(m), m.id);
    return m;
  }
  post(s: Session, roomId: string, input: MessageInput) {
    this.room(s, roomId);
    const old = this.db
      .prepare("SELECT data FROM messages WHERE id=?")
      .get(input.id) as Row | undefined;
    if (old) {
      const m = JSON.parse(old.data) as RoomMessage;
      if (
        m.authorId !== s.id ||
        m.roomId !== roomId ||
        m.body !== input.body ||
        m.parentId !== input.parentId ||
        JSON.stringify(m.context) !== JSON.stringify(input.context)
      )
        throw new HttpError(
          409,
          "Message ID already used for different content.",
        );
      return m;
    }
    if (input.parentId) this.get(s, roomId, input.parentId);
    return this.put(
      {
        ...input,
        roomId,
        authorId: s.id,
        author: s.name,
        createdAt: Date.now(),
        order: 0,
        seq: 0,
        kind: "human",
        provider: roomMention(input.body)?.provider ?? null,
        requestId: null,
        status: "sent",
        error: null,
        model: null,
      },
      true,
    );
  }
  start(s: Session, roomId: string, requestId: string, model: string) {
    return this.transaction(() => {
      const request = this.get(s, roomId, requestId);
      if (
        request.authorId !== s.id ||
        request.kind !== "human" ||
        !request.provider
      )
        throw new HttpError(
          403,
          "Only the sender can run their own agent request.",
        );
      const old = this.db
        .prepare("SELECT message_id FROM runs WHERE request_id=?")
        .get(requestId) as Row | undefined;
      if (old)
        return { message: this.get(s, roomId, old.message_id), started: false };
      const m = this.put(
        {
          ...request,
          id: randomUUID(),
          body: "",
          kind: "agent",
          parentId: request.id,
          requestId: request.id,
          status: "running",
          model,
          createdAt: Date.now(),
          error: null,
        },
        true,
      );
      this.db.prepare("INSERT INTO runs VALUES(?,?)").run(requestId, m.id);
      return { message: m, started: true };
    });
  }
  update(
    s: Session,
    roomId: string,
    id: string,
    body: string,
    status: RoomMessage["status"],
    error: string | null,
  ) {
    const m = this.get(s, roomId, id);
    if (m.kind !== "agent" || m.authorId !== s.id)
      throw new HttpError(403, "This agent belongs to another participant.");
    if (
      m.status !== "running" &&
      !(m.status === "failed" && m.error === DISCONNECTED_RUN)
    ) {
      if (m.body === body && m.status === status && m.error === error) return m;
      throw new HttpError(
        409,
        "This agent run is already finished. Retry with a new question.",
      );
    }
    if (m.body === body && m.status === status && m.error === error) {
      this.db
        .prepare("UPDATE messages SET updated=? WHERE id=?")
        .run(Date.now(), id);
      return m;
    }
    return this.put({ ...m, body, status, error });
  }
  expire() {
    const rows = this.db
      .prepare(
        "SELECT data FROM messages WHERE json_extract(data,'$.status')='running' AND updated<?",
      )
      .all(Date.now() - 90_000) as Row[];
    for (const row of rows) {
      const m = JSON.parse(row.data) as RoomMessage;
      if (m.status === "running")
        this.put({
          ...m,
          status: "failed",
          error: DISCONNECTED_RUN,
        });
    }
  }
  page(s: Session, roomId: string, after: number, before?: number) {
    this.room(s, roomId);
    // Bounded history and updates; mutable answer snapshots do not duplicate streaming text in the database.
    const rows = (
      before !== undefined
        ? this.db
            .prepare(
              "SELECT data FROM messages WHERE room_id=? AND ord<? ORDER BY ord DESC LIMIT 51",
            )
            .all(roomId, before)
        : after === 0
          ? this.db
              .prepare(
                "SELECT data FROM messages WHERE room_id=? ORDER BY ord DESC LIMIT 51",
              )
              .all(roomId)
          : this.db
              .prepare(
                "SELECT data FROM messages WHERE room_id=? AND seq>? ORDER BY seq LIMIT 101",
              )
              .all(roomId, after)
    ) as Row[];
    const limit = after > 0 && before === undefined ? 100 : 50;
    const messages = rows
      .slice(0, limit)
      .map((r) => JSON.parse(r.data) as RoomMessage)
      .sort((a, b) => a.order - b.order);
    const cursor =
      after === 0
        ? Number(
            (this.db.prepare("SELECT seq FROM clock WHERE id=1").get() as Row)
              .seq,
          )
        : Math.max(after, ...messages.map((m) => m.seq));
    return { messages, cursor, more: rows.length > limit };
  }
  topic(s: Session, roomId: string, parentId: string | null): RoomMessage[] {
    // Explicit ancestor chain only. Never silently include the whole room in an agent request.
    const out: RoomMessage[] = [];
    let budget = 48000;
    while (parentId && out.length < 16) {
      let m = this.get(s, roomId, parentId);
      // A long code excerpt can go; the agent can read the pinned lines itself.
      if (JSON.stringify(m).length > budget)
        m = { ...m, context: { ...m.context, excerpt: undefined } };
      const size = JSON.stringify(m).length;
      if (size > budget) break;
      budget -= size;
      out.unshift(m);
      parentId = m.parentId;
    }
    return out;
  }
  close() {
    this.db.close();
  }
}
