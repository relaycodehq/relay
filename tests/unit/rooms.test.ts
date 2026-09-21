import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomsDatabase, token } from "../../server/database";
import { createRoomsServer } from "../../server/http";
import {
  agentMention,
  roomServerSchema,
  type MessageInput,
} from "../../shared/rooms";

const project = {
  server: "https://gitea.example.test/gitea",
  owner: "Web",
  name: "portal",
};
const input = (body = "Hello"): MessageInput => ({
  id: randomUUID(),
  body,
  parentId: null,
  context: { head: "a".repeat(40), base: "b".repeat(40) },
});
const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});
function setup() {
  const db = new RoomsDatabase(":memory:");
  disposals.push(() => db.close());
  const aliceToken = token(),
    alice = db.create(project, "Alice", aliceToken),
    invite = db.invite(alice),
    bobToken = token(),
    bob = db.join(alice.projectId, invite.code, "Bob", bobToken),
    room = db.open(alice, 7, "Review the cache");
  return { db, alice, bob, room, aliceToken, bobToken };
}
describe("room authorization and durable conversation", () => {
  it("uses one-use invitations, retries redemption safely and revokes access", () => {
    const { db, alice, bobToken, bob } = setup();
    expect(db.authenticate(bobToken).id).toBe(bob.id);
    const i = db.invite(alice),
      s = token();
    const joined = db.join(alice.projectId, i.code, "Colleague", s);
    expect(db.join(alice.projectId, i.code, "Colleague", s)).toEqual(joined);
    expect(() =>
      db.join(alice.projectId, i.code, "Intruder", token()),
    ).toThrow();
    expect(() => db.invite(bob)).toThrow("owner");
    expect(() => db.revoke(bob, alice.id)).toThrow();
    db.revoke(alice, bob.id);
    expect(() => db.authenticate(bobToken)).toThrow("revoked");
  });
  it("keeps rooms isolated and lets only the requester reserve/publish an agent answer", () => {
    const { db, alice, bob, room } = setup();
    const other = db.create({ ...project, name: "other" }, "Charlie", token());
    expect(() => db.page(other, room.id, 0)).toThrow("Room not found");
    const m = db.post(alice, room.id, input("@codex Is this safe?"));
    expect(() => db.start(bob, room.id, m.id, "Luna")).toThrow("sender");
    const run = db.start(alice, room.id, m.id, "Luna");
    expect(run.started).toBe(true);
    expect(db.start(alice, room.id, m.id, "Luna").started).toBe(false);
    expect(() =>
      db.update(bob, room.id, run.message.id, "forged", "completed", null),
    ).toThrow("another participant");
  });
  it("deduplicates retrying a human message without losing its revision and reply context", () => {
    const { db, alice, room } = setup(),
      m = input();
    db.post(alice, room.id, m);
    db.post(alice, room.id, m);
    expect(db.page(alice, room.id, 0).messages).toHaveLength(1);
    expect(() => db.post(alice, room.id, { ...m, body: "changed" })).toThrow(
      "different content",
    );
    const reply = db.post(alice, room.id, {
      ...input("@codex Explain that"),
      parentId: m.id,
    });
    expect(db.topic(alice, room.id, reply.parentId).map((m) => m.body)).toEqual(
      ["Hello"],
    );
    expect(() =>
      db.post(alice, room.id, { ...input(), parentId: randomUUID() }),
    ).toThrow("not found");
  });
  it("pages durable history and sends revised answer snapshots after a cursor", () => {
    const { db, alice, room } = setup();
    for (let i = 0; i < 60; i++) db.post(alice, room.id, input(`Message ${i}`));
    const page = db.page(alice, room.id, 0);
    expect(page.messages).toHaveLength(50);
    expect(page.messages[0].body).toBe("Message 10");
    expect(page.more).toBe(true);
    expect(
      db.page(alice, room.id, 0, page.messages[0].order).messages,
    ).toHaveLength(10);
    const question = db.post(alice, room.id, input("@codex Check this"));
    const run = db.start(alice, room.id, question.id, "Luna");
    const first = db.page(alice, room.id, page.cursor);
    expect(first.messages).toHaveLength(2);
    db.update(
      alice,
      room.id,
      run.message.id,
      "Partial answer",
      "running",
      null,
    );
    expect(db.page(alice, room.id, first.cursor).messages[0].body).toBe(
      "Partial answer",
    );
  });
  it("recovers persisted messages on restart and marks abandoned runs without discarding partial text", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-rooms-db-"));
    let db = new RoomsDatabase(join(dir, "rooms.sqlite"));
    const secret = token(),
      s = db.create(project, "Alice", secret),
      r = db.open(s, 7, "PR");
    const m = db.post(s, r.id, input("@codex question")),
      run = db.start(s, r.id, m.id, "Luna");
    db.update(
      s,
      r.id,
      run.message.id,
      "Useful partial answer",
      "running",
      null,
    );
    db.db
      .prepare("UPDATE messages SET updated=0 WHERE id=?")
      .run(run.message.id);
    db.close();
    db = new RoomsDatabase(join(dir, "rooms.sqlite"));
    db.expire();
    const recovered = db.get(db.authenticate(secret), r.id, run.message.id);
    expect(recovered.body).toBe("Useful partial answer");
    expect(recovered.status).toBe("failed");
    db.close();
    rmSync(dir, { recursive: true });
  });
});
describe("mentions and transport", () => {
  it("requires an intentional leading mention and never invokes an agent for code or quoted mentions", () => {
    expect(agentMention("Hi @codex")).toBeNull();
    expect(agentMention("`@claude` question")).toBeNull();
    expect(agentMention("```\n@codex\n```")).toBeNull();
    expect(agentMention("@codexExample nope")).toBeNull();
    expect(agentMention(" @Claude explain this")).toEqual({
      provider: "claude",
      question: "explain this",
    });
  });
  it("requires encrypted remote transport, refuses credential URLs and permits loopback development", () => {
    expect(roomServerSchema.parse("http://127.0.0.1:4319/")).toBe(
      "http://127.0.0.1:4319",
    );
    for (const url of [
      "http://192.168.1.2:4319",
      "https://a:b@rooms.test",
      "file:///tmp/rooms",
      "https://rooms.test/path",
      "https://rooms.test/?token=x",
    ])
      expect(roomServerSchema.safeParse(url).success).toBe(false);
  });
  it("enforces HTTP authentication, rejects browser origins and validates message fields", async () => {
    const { db, aliceToken, room } = setup(),
      server = createRoomsServer(db, token());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as any).port}`;
      expect((await fetch(url + `/v1/rooms/${room.id}/messages`)).status).toBe(
        401,
      );
      expect(
        (
          await fetch(url + "/v1/me", {
            headers: {
              Authorization: `Bearer ${aliceToken}`,
              Origin: "https://evil.test",
            },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(url + `/v1/rooms/${room.id}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${aliceToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...input(), authorId: "fake" }),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await fetch(url + "/v1/me", {
            headers: { Authorization: `Bearer ${aliceToken}` },
          })
        ).status,
      ).toBe(200);
    } finally {
      await new Promise<void>((r, e) =>
        server.close((err) => (err ? e(err) : r())),
      );
    }
  });
});
