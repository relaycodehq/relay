import { it, expect, describe, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import {
  RoomDeliveries,
  deliveryPatch,
  outgoing,
  type RoomDelivery,
} from "./deliveries";
import { RoomAnswers } from "./answers";
import type { RoomAccess } from "./access";
import type { RoomConnections } from "./connections";
import type { RoomRequest } from "./transport";
import { HttpStatusError } from "../../shared/http";
import { defaultAISettings } from "../../shared/settings";

const agent = vi.hoisted(() => ({
  run: (_options: any) => Promise.resolve(""),
}));
vi.mock("../agents", () => ({
  agentRuntime: () => ({ run: (options: any) => agent.run(options) }),
}));

const delivery = (id: string, over: Partial<RoomDelivery> = {}) => ({
  key: "project",
  roomId: "room",
  id,
  body: "Answer",
  status: "completed" as const,
  error: null,
  ...over,
});

describe("outgoing", () => {
  it("marks an answer cut off by a closed app as failed, keeping its partial text", () => {
    const pending = delivery("a", { status: "running", body: "Half" });
    expect(outgoing(pending, false)).toMatchObject({
      status: "failed",
      body: "Half",
      error: expect.stringContaining("The app closed"),
    });
    expect(pending.status).toBe("running");
    expect(outgoing(pending, true)).toEqual(pending);
    expect(outgoing(delivery("b"), false)).toEqual(delivery("b"));
  });
  it("sends no text while running and redacts secrets once done", () => {
    const key = "sk-ant-" + "a".repeat(30);
    expect(
      deliveryPatch(delivery("a", { status: "running", body: key })).body,
    ).toBe("");
    const done = deliveryPatch(
      delivery("a", { status: "failed", body: `Use ${key}`, error: key }),
    );
    expect(done.body).not.toContain(key);
    expect(done.error).not.toContain(key);
  });
});

describe("RoomDeliveries.flush", () => {
  let root: string, store: Store;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "relay-deliveries-"));
    store = new Store(root);
    await store.load();
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  function outbox(
    send: (path: string, body: any) => Promise<unknown>,
    running = new Set<string>(),
  ) {
    const connections = {
      get: async () => ({ server: "https://rooms.test", token: "t" }),
    } as unknown as RoomConnections;
    const access = { ensure: async () => {} } as unknown as RoomAccess;
    return new RoomDeliveries(
      store,
      async (_server, path, _token, _method, body) => send(path, body) as any,
      connections,
      access,
      (id) => running.has(id),
    );
  }
  const c = { key: "project" } as any;

  it("sends this project's answers, drops the delivered ones and keeps running and ones that failed in passing", async () => {
    await store.update((s) => {
      s.roomDeliveries = {
        refused: delivery("refused"),
        done: delivery("done"),
        live: delivery("live", { status: "running" }),
        other: delivery("other", { key: "elsewhere" }),
      };
    });
    const sent: string[] = [];
    await outbox(
      async (path, body) => {
        sent.push(`${path} ${body.status}`);
        if (path.endsWith("/refused")) throw new Error("Offline.");
      },
      new Set(["live"]),
    ).flush(c);
    expect(sent).toEqual([
      "/v1/rooms/room/messages/refused completed",
      "/v1/rooms/room/messages/done completed",
      "/v1/rooms/room/messages/live running",
    ]);
    expect(Object.keys(store.get().roomDeliveries!)).toEqual([
      "refused",
      "live",
      "other",
    ]);
  });

  it("lets go of an answer the server refused for good, but keeps one refused in passing", async () => {
    await store.update((s) => {
      s.roomDeliveries = {
        gone: delivery("gone"),
        finished: delivery("finished"),
        limited: delivery("limited"),
        expired: delivery("expired"),
        rest: delivery("rest"),
      };
    });
    const refusals: Record<string, number> = {
      gone: 404,
      finished: 409,
      limited: 429,
      expired: 428,
    };
    const sent: string[] = [];
    const deliveries = outbox(async (path) => {
      const id = path.split("/").pop()!;
      sent.push(id);
      if (refusals[id]) throw new HttpStatusError("Refused.", refusals[id]);
    });
    await deliveries.flush(c);
    expect(sent).toEqual(["gone", "finished", "limited", "expired", "rest"]);
    expect(Object.keys(store.get().roomDeliveries!)).toEqual([
      "limited",
      "expired",
    ]);
    await deliveries.flush(c);
    expect(sent.slice(5)).toEqual(["limited", "expired"]);
  });

  it("cuts an answer longer than the server keeps, marked as cut, instead of having it refused", async () => {
    await store.update((s) => {
      s.roomDeliveries = {
        long: delivery("long", { body: "a".repeat(250_000) }),
        exact: delivery("exact", { body: "b".repeat(100_000) }),
      };
    });
    const bodies: Record<string, string> = {};
    await outbox(async (path, body) => {
      bodies[path.split("/").pop()!] = body.body;
    }).flush(c);
    expect(bodies.long).toHaveLength(100_000);
    expect(bodies.long.endsWith("… (truncated)")).toBe(true);
    expect(bodies.long.startsWith("aaaa")).toBe(true);
    expect(bodies.exact).toBe("b".repeat(100_000));
    expect(store.get().roomDeliveries).toEqual({});
  });

  it("keeps an answer saved again while it was being sent, and sends it after, one flush per project at a time", async () => {
    await store.update((s) => {
      s.roomDeliveries = { a: delivery("a") };
    });
    const sent: string[] = [];
    let open = 0,
      most = 0;
    const deliveries = outbox(async (_path, body) => {
      most = Math.max(most, ++open);
      sent.push(body.body);
      if (sent.length === 1)
        await deliveries.save("a", () => delivery("a", { body: "Newer" }));
      open--;
    });
    await Promise.all([deliveries.flush(c), deliveries.flush(c)]);
    expect(most).toBe(1);
    expect(sent).toEqual(["Answer", "Newer"]);
    expect(store.get().roomDeliveries).toEqual({});
  });
});

describe("RoomAnswers delivering a finished answer", () => {
  let root: string, store: Store;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "relay-answers-"));
    store = new Store(root);
    await store.load();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  async function finishWhileHeartbeatSends() {
    const patches: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const request = (async (_server, path, _token, method, body: any) => {
      if (path.endsWith("/topic")) return [];
      if (path.endsWith("/runs"))
        return { message: { id: "answer" }, started: true };
      if (method === "PATCH") {
        patches.push(`${body.status} ${body.body}`);
        if (body.status === "running") await held;
      }
    }) as RoomRequest;
    const connections = {
      get: async () => ({ server: "https://rooms.test", token: "t" }),
    } as unknown as RoomConnections;
    const access = { ensure: async () => {} } as unknown as RoomAccess;
    const deliveries: RoomDeliveries = new RoomDeliveries(
      store,
      request,
      connections,
      access,
      (id) => answers.running(id),
    );
    const answers = new RoomAnswers(request, deliveries);
    let finish!: (text: string) => void;
    agent.run = (options) => {
      options.onText("Half");
      return new Promise((r) => (finish = r));
    };
    const c = { key: "project", dir: "/repo" } as any;
    await answers.ask(c, {
      connection: { server: "https://rooms.test", token: "t" },
      roomId: "room",
      request: { id: "question" },
      input: { id: "question", choice: defaultAISettings.questions },
      mention: { provider: "codex", question: "Why?" },
      pull: { html_url: "https://gitea.test/pr", title: "PR" },
      context: { head: "a", base: "b" },
      local: { dirty: false, head: "a" },
    } as any);

    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(patches).toEqual(["running "]));
    finish("Final");
    await answers.halt();
    expect(store.get().roomDeliveries?.answer.status).toBe("completed");
    release();

    // No poll follows: the room panel is closed.
    await vi.waitFor(() =>
      expect(patches).toEqual(["running ", "completed Final"]),
    );
    await vi.waitFor(() =>
      expect(store.get().roomDeliveries ?? {}).toEqual({}),
    );
  }
  it(
    "sends the final answer when it finishes while a heartbeat's send is still in flight",
    finishWhileHeartbeatSends,
  );
});
