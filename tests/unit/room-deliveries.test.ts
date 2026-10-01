import { it, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../electron/store";
import {
  RoomDeliveries,
  deliveryPatch,
  outgoing,
  type RoomDelivery,
} from "../../electron/rooms/deliveries";
import type { RoomAccess } from "../../electron/rooms/access";
import type { RoomConnections } from "../../electron/rooms/connections";

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

  it("sends this project's answers, drops the delivered ones and keeps running and refused ones", async () => {
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
        if (path.endsWith("/refused")) throw new Error("Not found.");
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

  it("keeps an answer saved again while it was being sent, and runs one flush per project at a time", async () => {
    await store.update((s) => {
      s.roomDeliveries = { a: delivery("a") };
    });
    let calls = 0;
    const deliveries = outbox(async () => {
      calls++;
      await deliveries.save("a", () => delivery("a", { body: "Newer" }));
    });
    await Promise.all([deliveries.flush(c), deliveries.flush(c)]);
    expect(calls).toBe(1);
    expect(store.get().roomDeliveries?.a.body).toBe("Newer");
  });
});
