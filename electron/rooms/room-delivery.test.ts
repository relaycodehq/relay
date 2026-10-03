import {
  roomVerifier,
  roomClient,
  roomClone,
} from "../../tests/fixtures/room-access";
import { it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { RoomService } from "./service";
import { Store } from "../app/store";
import { RoomsDatabase, token } from "../../server/database";
import { createRoomsServer } from "../../server/http";
import { sendRoomSchema } from "../../shared/rooms";
import { defaultAISettings } from "../../shared/settings";
import { runCodex } from "../agents/codex/codex";
import type { Gitea } from "../pull-requests/gitea";

vi.mock("../agents/codex/codex", () => ({ runCodex: vi.fn() }));
vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(async () => "/test/codex"),
}));
it("retries a redeemed invitation after a lost response without a secure credential store", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-room-join-"));
  const store = new Store(join(root, "state"));
  await store.load();
  const database = new RoomsDatabase(join(root, "rooms.sqlite"));
  const setup = token(),
    server = createRoomsServer(database, setup, roomVerifier);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const project = {
    server: "https://gitea.test",
    owner: "Web",
    name: "portal",
  };
  const ownerToken = token();
  const owner = await fetch(url + "/v1/projects", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${setup}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project,
      name: "Alice",
      sessionToken: ownerToken,
      giteaToken: "alice",
    }),
  }).then((r) => r.json());
  const invite = await fetch(url + "/v1/invites", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  }).then((r) => r.json());
  const context = {
    key: "bob-project",
    ref: { owner: project.owner, name: project.name, number: 7 },
    dir: await roomClone(join(root, "repo"), project),
    client: roomClient(project, "bob"),
  };
  let dropResponse = true;
  const service = new RoomService(
    store,
    async (url, init) => {
      const response = await fetch(url, init);
      if (url.endsWith("/v1/join") && dropResponse) {
        dropResponse = false;
        await response.arrayBuffer();
        throw new Error("Response lost after redemption");
      }
      return response;
    },
    async () => null,
    async () => {
      throw new Error("No secure store");
    },
  );
  const input = {
    server: url,
    projectId: owner.projectId,
    secret: invite.code,
  };
  try {
    await service.allowAccess(context, url);
    await expect(service.connect(context, input)).rejects.toThrow(
      "Response lost",
    );
    const state = await service.connect(context, input);
    expect(state.connection?.persistent).toBe(false);
    expect(state.room?.number).toBe(7);
    expect(Object.keys(store.get().roomConnections ?? {})).toHaveLength(0);
    const members = await service.members(context);
    expect(members.filter((m) => m.name === "bob")).toHaveLength(1);
  } finally {
    await service.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("recovers a final answer from disk after network loss and app restart without invoking the agent again", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-room-delivery-")),
    repo = join(root, "repo");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", "https://gitea.test/Web/portal.git");
  await writeFile(join(repo, "README.md"), "Fixture");
  git("add", ".");
  git("commit", "--quiet", "-m", "Fixture");
  const store = new Store(join(root, "state"));
  await store.load();
  const database = new RoomsDatabase(join(root, "rooms.sqlite")),
    key = token(),
    server = createRoomsServer(database, key, roomVerifier);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const ref = { owner: "Web", name: "portal", number: 7 };
  const client = {
    ...roomClient({
      server: "https://gitea.test",
      owner: "Web",
      name: "portal",
    }),
    account: {
      id: "alice",
      server: "https://gitea.test",
      user: { login: "alice" },
    },
    pull: async () => ({
      head: { sha: "a".repeat(40) },
      merge_base: "b".repeat(40),
      html_url: "https://gitea.test/Web/portal/pulls/7",
      title: "Fixture PR",
    }),
  } as unknown as Gitea;
  const context = { client, ref, key: "alice-project", dir: repo };
  let offline = false;
  const network: typeof fetch = async (url, init) => {
    if (offline) throw new Error("Network offline");
    return fetch(url, init);
  };
  const encrypt = async (s: string) => Buffer.from(s).toString("base64"),
    decrypt = async (s: string) => Buffer.from(s, "base64").toString();
  const service = new RoomService(store, network, encrypt, decrypt);
  let finish!: (s: string) => void;
  vi.mocked(runCodex).mockImplementation(async (options) => {
    options.onText("Partial answer");
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  try {
    await service.allowAccess(context, url);
    await service.connect(context, { server: url, secret: key });
    await service.send(
      context,
      sendRoomSchema.parse({
        id: randomUUID(),
        body: "@codex Explain the fixture",
        parentId: null,
        context: { head: "a".repeat(40), base: "b".repeat(40) },
        choice: defaultAISettings.questions,
      }),
    );
    expect(runCodex).toHaveBeenCalledTimes(1);
    offline = true;
    finish("The final answer survived disconnection.");
    await vi.waitFor(() =>
      expect(Object.values(store.get().roomDeliveries ?? {})[0]?.status).toBe(
        "completed",
      ),
    );
    await service.dispose();
    await store.flush();
    const restored = new Store(join(root, "state"));
    await restored.load();
    offline = false;
    const restarted = new RoomService(restored, network, encrypt, decrypt);
    await restarted.flush(context);
    const page = await restarted.poll(context, 0);
    expect(
      page.messages.some(
        (m) =>
          m.body === "The final answer survived disconnection." &&
          m.status === "completed",
      ),
    ).toBe(true);
    expect(Object.keys(restored.get().roomDeliveries ?? {})).toHaveLength(0);
    expect(runCodex).toHaveBeenCalledTimes(1);
    await restarted.dispose();
  } finally {
    await service.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("delivers a long answer in a non-Latin script, and a rejected delivery holds back no later one", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-room-long-")),
    project = { server: "https://gitea.test", owner: "Web", name: "portal" };
  const store = new Store(join(root, "state"));
  await store.load();
  const database = new RoomsDatabase(":memory:"),
    key = token(),
    server = createRoomsServer(database, key, roomVerifier);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const client = {
    ...roomClient(project),
    pull: async () => ({
      head: { sha: "a".repeat(40) },
      merge_base: "b".repeat(40),
      html_url: "https://gitea.test/Web/portal/pulls/7",
      title: "Fixture PR",
    }),
  } as unknown as Gitea;
  const context = {
    client,
    ref: { ...project, number: 7 },
    key: "alice-project",
    dir: await roomClone(join(root, "repo"), project),
  };
  const encode = async (s: string) => Buffer.from(s).toString("base64"),
    decode = async (s: string) => Buffer.from(s, "base64").toString();
  const service = new RoomService(store, fetch, encode, decode);
  const ask = async (answer: string) => {
    vi.mocked(runCodex).mockResolvedValueOnce(answer);
    await service.send(
      context,
      sendRoomSchema.parse({
        id: randomUUID(),
        body: "@codex Explain the fixture",
        parentId: null,
        context: { head: "a".repeat(40), base: "b".repeat(40) },
        choice: defaultAISettings.questions,
      }),
    );
    await vi.waitFor(async () => {
      await service.flush(context);
      const shared = database.db.prepare("SELECT data FROM messages").all();
      expect(
        shared
          .map((r) => JSON.parse(String(r.data)))
          .some((m) => m.body === answer && m.status === "completed"),
      ).toBe(true);
    }, 10_000);
  };
  try {
    await service.allowAccess(context, url);
    const { room } = await service.connect(context, {
      server: url,
      secret: key,
    });
    // A delivery the server refuses: it has no such message.
    const lost = randomUUID();
    await store.update((s) => {
      s.roomDeliveries = {
        [lost]: {
          key: context.key,
          roomId: room!.id,
          id: lost,
          body: "Lost",
          status: "completed",
          error: null,
        },
      };
    });
    await ask("Short answer.");
    // 70,000 characters of Japanese is 210 kB of UTF-8.
    await ask("答".repeat(70_000));
  } finally {
    await service.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses a second @agent question sent while the first is still posting, without posting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-room-double-")),
    project = { server: "https://gitea.test", owner: "Web", name: "portal" };
  const store = new Store(join(root, "state"));
  await store.load();
  const database = new RoomsDatabase(":memory:"),
    key = token(),
    server = createRoomsServer(database, key, roomVerifier);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const client = {
    ...roomClient(project),
    pull: async () => ({
      head: { sha: "a".repeat(40) },
      merge_base: "b".repeat(40),
      html_url: "https://gitea.test/Web/portal/pulls/7",
      title: "Fixture PR",
    }),
  } as unknown as Gitea;
  const context = {
    client,
    ref: { ...project, number: 7 },
    key: "alice-project",
    dir: await roomClone(join(root, "repo"), project),
  };
  const encode = async (s: string) => Buffer.from(s).toString("base64"),
    decode = async (s: string) => Buffer.from(s, "base64").toString();
  const service = new RoomService(store, fetch, encode, decode);
  const question = (body: string) =>
    sendRoomSchema.parse({
      id: randomUUID(),
      body,
      parentId: null,
      context: { head: "a".repeat(40), base: "b".repeat(40) },
      choice: defaultAISettings.questions,
    });
  const posted = () =>
    database.db
      .prepare("SELECT data FROM messages")
      .all()
      .map((r) => JSON.parse(String(r.data)).body as string)
      .filter((body) => body.startsWith("@codex"));
  let finish!: (answer: string) => void;
  vi.mocked(runCodex).mockImplementation(
    () => new Promise<string>((resolve) => (finish = resolve)),
  );
  try {
    await service.allowAccess(context, url);
    await service.connect(context, { server: url, secret: key });
    const results = await Promise.allSettled([
      service.send(context, question("@codex First")),
      service.send(context, question("@codex Second")),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason.message).toContain(
      "is answering another question",
    );
    expect(posted()).toEqual(["@codex First"]);
    // A question that fails before it posts frees the slot for the next.
    finish("Done.");
    await vi.waitFor(() =>
      expect(
        (service as unknown as { answers: { busy: boolean } }).answers.busy,
      ).toBe(false),
    );
    await expect(
      service.send(context, {
        ...question("@codex Third"),
        context: { head: "c".repeat(40), base: "b".repeat(40) },
      }),
    ).rejects.toThrow("This PR changed");
    await service.send(context, question("@codex Fourth"));
    expect(posted()).toEqual(["@codex First", "@codex Fourth"]);
  } finally {
    finish?.("Done.");
    await service.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
