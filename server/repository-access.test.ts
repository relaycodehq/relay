import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RoomsDatabase, token } from "./database";
import { createRoomsServer } from "./http";
import { GiteaRepositoryVerifier } from "./repository-access";
const project = {
  server: "https://gitea.test/prefix",
  owner: "Web",
  name: "portal",
};
function verifier() {
  let revoked = false;
  const network = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const credential = new Headers(init?.headers).get("authorization");
    if (revoked || !["token alice", "token bob"].includes(credential ?? ""))
      return new Response("{}", { status: 403 });
    return Response.json(
      String(url).endsWith("/user")
        ? {
            id: credential === "token alice" ? 1 : 2,
            login: credential === "token alice" ? "alice" : "bob",
          }
        : { id: 7, full_name: "Web/portal", permissions: { pull: true } },
    );
  });
  return {
    value: new GiteaRepositoryVerifier([project.server], network),
    network,
    revoke: () => {
      revoked = true;
    },
  };
}
it("rejects non-allowlisted targets without sending a credential, and refuses redirects/invalid identities", async () => {
  const v = verifier();
  await expect(
    v.value.verify({ ...project, server: "https://attacker.test" }, "alice"),
  ).rejects.toThrow("not enabled");
  expect(v.network).not.toHaveBeenCalled();
  await expect(v.value.verify(project, "wrong")).rejects.toThrow(
    "could not verify",
  );
  expect(
    v.network.mock.calls.every(([, init]) => init?.redirect === "error"),
  ).toBe(true);
  const bad = new GiteaRepositoryVerifier([project.server], async () =>
    Response.json({ id: 1, login: "alice", full_name: "Web/other" }),
  );
  await expect(bad.verify(project, "alice")).rejects.toThrow("did not match");
});
it("gates every shared resource on verified repo access, binds identity, and rejects revoked permissions after expiration", async () => {
  const db = new RoomsDatabase(":memory:"),
    key = token(),
    v = verifier(),
    server = createRoomsServer(db, key, v.value);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (path: string, secret?: string, body?: unknown) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(secret ? { Authorization: "Bearer " + secret } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const alice = token();
    expect(
      (
        await request("/v1/projects", key, {
          project,
          name: "Forged name",
          sessionToken: alice,
          giteaToken: "wrong",
        })
      ).status,
    ).toBe(403);
    const created = await request("/v1/projects", key, {
      project,
      name: "Forged name",
      sessionToken: alice,
      giteaToken: "alice",
    });
    expect(created.status).toBe(200);
    const owner = await created.json();
    expect(owner.member.name).toBe("alice");
    const invite = await (await request("/v1/invites", alice, {})).json(),
      bob = token();
    expect(
      (
        await request("/v1/join", undefined, {
          projectId: owner.projectId,
          project,
          code: invite.code,
          name: "bob",
          sessionToken: bob,
          giteaToken: "wrong",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/v1/join", undefined, {
          projectId: owner.projectId,
          project,
          code: invite.code,
          name: "bob",
          sessionToken: bob,
          giteaToken: "bob",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/v1/access", bob, { giteaToken: "alice" })).status,
    ).toBe(403);
    const roomId = randomUUID(),
      now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61000);
    v.revoke();
    for (const path of [
      "/v1/me",
      `/v1/rooms/${roomId}/workspace`,
      `/v1/rooms/${roomId}/presence`,
    ])
      expect((await request(path, bob)).status, path).toBe(428);
    expect(
      (await request("/v1/access", bob, { giteaToken: "bob" })).status,
    ).toBe(403);
  } finally {
    vi.restoreAllMocks();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
it("migrates populated legacy rooms without losing content", () => {
  const db = new RoomsDatabase(":memory:");
  try {
    const s = db.create(project, "Alice", token()),
      room = db.open(s, 7, "Existing PR"),
      old = {
        id: randomUUID(),
        body: "Existing message",
        parentId: null,
        context: { head: "a".repeat(40), base: "b".repeat(40) },
      };
    db.post(s, room.id, old);
    expect(db.page(s, room.id, 0).messages[0].body).toBe("Existing message");
    expect(db.open(s, 7, "Updated title").id).toBe(room.id);
    expect(db.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
