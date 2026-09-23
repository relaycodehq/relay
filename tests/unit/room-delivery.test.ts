import { roomVerifier, roomClient, roomClone } from "../fixtures/room-access";
import { it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { RoomService } from "../../electron/rooms/service";
import { Store } from "../../electron/store";
import { RoomsDatabase, token } from "../../server/database";
import { createRoomsServer } from "../../server/http";
import { sendRoomSchema } from "../../shared/rooms";
import { defaultAISettings } from "../../shared/settings";
import { runCodex } from "../../electron/rooms/codex";
import type { Gitea } from "../../electron/gitea";

vi.mock("../../electron/rooms/codex", () => ({ runCodex: vi.fn() }));
vi.mock("../../electron/executables", async (actual) => ({
  ...(await actual<typeof import("../../electron/executables")>()),
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
