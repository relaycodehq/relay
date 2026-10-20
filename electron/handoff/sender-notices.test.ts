import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Computers } from "./computers";
import { Handoffs } from "./sender";
import type { ProjectChats } from "../project-chats";
import type { Projects } from "../projects/projects";
import type { RemoteClient } from "../../shared/remote-client";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-handoff-notices-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function setup(call: (method: string, id: string) => Promise<void>) {
  const store = new Store(root);
  await store.load();
  await store.update((s) => {
    s.chats = ["c1", "c2"].map((id, i) => ({
      id,
      sentTo: {
        id: `h${i + 1}`,
        computerId: "pc",
        computer: "Mini",
        state: "away",
        live: true,
      },
    })) as typeof s.chats;
    s.computers = [{ id: "pc", name: "Mini" }] as typeof s.computers;
  });
  const computers = new Computers(
    store,
    async () => null,
    async () => "unused",
  );
  vi.spyOn(computers, "connected").mockResolvedValue({ call } as RemoteClient);
  const chats = {
    startsThereWith: () => {},
    abandonHandoff: async (chatId: string, id: string) => {
      if (store.get().chats!.find((c) => c.id === chatId)?.sentTo?.id !== id)
        return false;
      await store.update((s) => {
        delete s.chats!.find((c) => c.id === chatId)!.sentTo;
      });
      return true;
    },
  } as unknown as ProjectChats;
  const sender = new Handoffs(store, computers, chats, {} as Projects, root);
  return { sender, store, computers };
}

it("keeps a second takeback's notification while the first one is being acknowledged", async () => {
  let finishFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const called: string[] = [];
  const { sender, computers, store } = await setup(async (method, id) => {
    expect(method).toBe("handoffAbandoned");
    called.push(id);
    if (id === "h1") await first;
  });
  await sender.abandon("c1");
  await vi.waitFor(() => expect(called).toEqual(["h1"]));
  await sender.abandon("c2");
  expect(computers.get("pc").abandoned).toEqual(["h1", "h2"]);
  finishFirst();
  await vi.waitFor(() => expect(called).toEqual(["h1", "h2"]));
  await vi.waitFor(() => expect(computers.get("pc").abandoned).toBeUndefined());
  await store.flush();
});

it("keeps a failed notification for reconnect while delivering a newer takeback", async () => {
  let finishFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const called: string[] = [];
  const { sender, computers, store } = await setup(async (_method, id) => {
    called.push(id);
    if (id === "h1") {
      await first;
      throw new Error("Lost the link.");
    }
  });
  await sender.abandon("c1");
  await vi.waitFor(() => expect(called).toEqual(["h1"]));
  await sender.abandon("c2");
  finishFirst();
  await vi.waitFor(() => expect(called).toEqual(["h1", "h1", "h2"]));
  await vi.waitFor(() => expect(computers.get("pc").abandoned).toEqual(["h1"]));
  await store.flush();
  const restarted = new Store(root);
  await restarted.load();
  expect(restarted.get().computers![0]!.abandoned).toEqual(["h1"]);
});

it("adds concurrent pending notices against the latest persisted list", async () => {
  const { computers, store } = await setup(async () => {});
  await Promise.all(
    ["h1", "h2"].map((id) =>
      computers.setPending("pc", "abandoned", (pending) => [...pending, id]),
    ),
  );
  expect(computers.get("pc").abandoned).toEqual(["h1", "h2"]);
  await store.flush();
});
