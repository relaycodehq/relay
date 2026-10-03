import { it, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  realpath,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Store } from "../app/store";
import { Projects } from "./projects";
import { ProjectChats } from "../project-chats";
import { ProjectSharing } from "./project-sharing";
import { RoomService } from "../rooms/service";
import { Gitea } from "../pull-requests/gitea";
import { runCodex } from "../agents/codex/codex";
import { RoomsDatabase, token } from "../../server/database";
import { createRoomsServer } from "../../server/http";
import { GiteaRepositoryVerifier } from "../../server/repository-access";
import { fixtureServer } from "../../tests/fixtures/gitea";
import { defaultAISettings } from "../../shared/settings";
vi.mock("../agents/codex/codex", () => ({ runCodex: vi.fn() }));
it("shares private history, streams only to the requester, runs each participant’s agent locally, and recovers final delivery after restart", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-shared-chat-")),
    ),
    fixture = await fixtureServer({
      users: {
        "test-alice": { id: 1, login: "alice", full_name: "Alice" },
        "test-bob": { id: 2, login: "bob", full_name: "Bob" },
      },
    });
  const db = new RoomsDatabase(join(root, "rooms.sqlite")),
    setup = token(),
    server = createRoomsServer(
      db,
      setup,
      new GiteaRepositoryVerifier([fixture.serverUrl]),
    );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const peers: any[] = [];
  let finish!: (s: string) => void;
  let askApproval = true;
  const turns = () =>
    vi.mocked(runCodex).mock.calls.filter(([options]) => !options.helper);
  vi.mocked(runCodex).mockImplementation(async (options) => {
    // The thread-title helper runs beside the agent's turn; it neither asks nor streams.
    if (options.helper) return "";
    await options.session?.onId("local-session-" + options.cwd);
    options.onText("Private streamed partial");
    if (askApproval) {
      askApproval = false;
      await options.onRequest!({
        kind: "approval",
        title: "Private local approval",
        detail: "Private command and checkout path",
        decisions: ["accept", "decline"],
      });
    }
    return new Promise<string>((resolve, reject) => {
      finish = resolve;
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("Cancelled")),
        { once: true },
      );
    });
  });
  try {
    for (const [index, name] of ["alice", "bob"].entries()) {
      const dir = join(root, name);
      await mkdir(dir);
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
      git("init", "-q");
      git("config", "user.name", name);
      git("config", "user.email", name + "@example.invalid");
      git(
        "remote",
        "add",
        "origin",
        fixture.serverUrl + "/Web/web-store.git",
      );
      await writeFile(join(dir, "index.ts"), "export const x = 1;\n");
      git("add", ".");
      git("commit", "-qm", "Base");
      const store = new Store(join(root, name + "-state"));
      await store.load();
      const client = new Gitea(
          {
            id: name,
            server: fixture.serverUrl,
            user: { id: index + 1, login: name },
            persistent: true,
          },
          "test-" + name,
          fetch,
        ),
        projects = new Projects(store);
      const project = await projects.add(dir, client);
      expect(project.repository?.name).toBe("web-store");
      const peer: any = {
        store,
        client,
        projects,
        project,
        offline: false,
        dir,
        git,
        events: [],
      };
      peer.rooms = new RoomService(
        store,
        async (...args) => {
          if (peer.offline) throw new Error("Offline");
          return fetch(...args);
        },
        async (s) => Buffer.from(s).toString("base64"),
        async (s) => Buffer.from(s, "base64").toString(),
      );
      peer.sharing = new ProjectSharing(projects, peer.rooms, () => client);
      peer.chats = new ProjectChats(
        store,
        projects,
        join(root, name + "-chats"),
        (e) => peer.events.push(structuredClone(e)),
        peer.sharing,
      );
      peers.push(peer);
    }
    const [alice, bob] = peers;
    await alice.rooms.saveHosting({ server: url, secret: setup });
    const chat = await alice.chats.create(alice.project.id, {
        kind: "project",
      }),
      send = (body: string) => ({
        id: randomUUID(),
        body,
        provider: "codex" as const,
        runtimeMode: "approval-required" as const,
        interactionMode: "default" as const,
        choice: defaultAISettings.questions,
      });
    await alice.chats.send(chat.id, send("A useful private note."));
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get(),
    ).toEqual({ n: 0 });
    await alice.chats.share(chat.id);
    const invite = await alice.chats.invite(chat.id);
    const joined = await bob.chats.join(bob.project.id, invite.url);
    expect(joined.id).toBe(chat.id);
    expect((await bob.chats.get(chat.id)).messages[0]).toMatchObject({
      body: "A useful private note.",
      author: "Alice",
    });
    await alice.chats.send(chat.id, send("@codex Explain the repository"));
    await vi.waitFor(() =>
      expect(
        alice.events.some(
          (e: any) => e.message.body === "Private streamed partial",
        ),
      ).toBe(true),
    );
    expect(
      (await bob.chats.sync(chat.id)).messages.some(
        (m: any) => m.role === "assistant",
      ),
    ).toBe(false);
    expect(turns()[0][0].cwd).toBe(alice.dir);
    const pending = (await alice.chats.get(chat.id)).requests[0];
    expect(pending.title).toBe("Private local approval");
    const remote = await bob.chats.sync(chat.id);
    expect(remote.requests).toEqual([]);
    expect(JSON.stringify(remote)).not.toContain(
      "Private command and checkout path",
    );
    expect(() =>
      bob.chats.respond(chat.id, pending.id, {
        kind: "approval",
        decision: "accept",
      }),
    ).toThrow("no longer running");
    await alice.chats.respond(chat.id, pending.id, {
      kind: "approval",
      decision: "accept",
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    alice.offline = true;
    finish("A completed explanation.");
    await vi.waitFor(async () =>
      expect((await alice.chats.get(chat.id)).messages.at(-1).status).toBe(
        "complete",
      ),
    );
    await alice.chats.dispose();
    alice.chats = new ProjectChats(
      alice.store,
      alice.projects,
      join(root, "alice-chats"),
      (e) => alice.events.push(e),
      alice.sharing,
    );
    alice.offline = false;
    await alice.chats.sync(chat.id);
    const delivered = await bob.chats.sync(chat.id);
    expect(delivered.messages.at(-1)).toMatchObject({
      body: "A completed explanation.",
      author: "Alice",
      status: "complete",
    });
    expect(turns()).toHaveLength(1);
    await bob.chats.send(chat.id, {
      ...send("@codex What about the edge case?"),
      parentId: delivered.messages[0].id,
    });
    // The agent starts once Relay has snapshotted the checkout for the turn.
    await vi.waitFor(() => expect(turns()[1]?.[0].cwd).toBe(bob.dir));
    await vi.waitFor(() =>
      expect(
        bob.events.some(
          (e: any) => e.message.body === "Private streamed partial",
        ),
      ).toBe(true),
    );
    finish("Bob’s completed answer.");
    await vi.waitFor(async () =>
      expect((await bob.chats.get(chat.id)).messages.at(-1).status).toBe(
        "complete",
      ),
    );
    expect((await alice.chats.sync(chat.id)).messages.at(-1).author).toBe(
      "Bob",
    );
    bob.git(
      "remote",
      "set-url",
      "origin",
      "https://other.invalid/Wrong/repository.git",
    );
    await expect(bob.chats.sync(chat.id)).rejects.toThrow(
      "clone no longer matches",
    );
    expect(
      await readFile(join(root, "alice-state", "state.json"), "utf8"),
    ).not.toContain("test-alice");
  } finally {
    for (const peer of peers) {
      await peer.chats.dispose();
      await peer.rooms.dispose();
      peer.client.dispose();
    }
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
it("accepts shared messages from every agent a thread can talk to", async () => {
  const { sharedMessagesSchema } = await import("../../server/conversations");
  const { agentProviders } = await import("../../shared/agents");
  for (const provider of agentProviders)
    expect(
      sharedMessagesSchema.safeParse({
        messages: [
          {
            id: randomUUID(),
            role: "assistant",
            body: "Done.",
            status: "complete",
            created: 1,
            provider,
            version: 1,
          },
        ],
      }).success,
    ).toBe(true);
});
