import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../app/store";
import { ChatStorage } from "./storage";
import type { ChatMessage, ProjectChat } from "../../shared/projects";

let root: string, store: Store, storage: ChatStorage, changed: string[];

const open = async () => {
  store = new Store(join(root, "state"));
  await store.load();
  storage = new ChatStorage(store, join(root, "chats"), () => false);
  changed = [];
  storage.onSummaries((projectId) => changed.push(projectId));
};
const answer = (body: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  body,
  status: "streaming",
  created: 1,
  provider: "codex",
  version: 1,
});
const thread = (): ProjectChat => ({
  id: crypto.randomUUID(),
  projectId: "p",
  scope: { kind: "project" },
  title: "Thread",
  created: 1,
  updated: 1,
  messages: [],
});
const listed = (chat: ProjectChat) =>
  store.get().chats!.find((c) => c.id === chat.id)!;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-chat-storage-"));
  await open();
});
afterEach(() => rm(root, { recursive: true, force: true }));

it("writes the summary when a save changes what the sidebar lists, and only then", async () => {
  const chat = thread();
  await storage.add(chat);
  chat.messages.push(answer("Hel"));
  await storage.save(chat);
  expect(listed(chat)).toMatchObject({ provider: "codex", empty: false });

  const write = vi.spyOn(store, "update");
  changed.length = 0;
  for (const body of ["Hello", "Hello wor", "Hello world"]) {
    chat.messages[0]!.body = body;
    await storage.save(chat);
  }
  expect(write).not.toHaveBeenCalled();
  expect(changed).toEqual([]);

  chat.title = "Greeting";
  await storage.save(chat);
  expect(listed(chat).title).toBe("Greeting");
  expect(write).toHaveBeenCalledTimes(1);
  expect(changed).toEqual(["p"]);
});

it("holds the summary back until it is synced", async () => {
  const chat = thread();
  await storage.add(chat);
  chat.updated = 99;
  await storage.save(chat, { holdSummary: true });
  expect(listed(chat).updated).toBe(1);
  await storage.syncSummary(chat);
  expect(listed(chat).updated).toBe(99);
});

it("leaves a thread that isn't listed to add", async () => {
  const chat = thread();
  storage.keep(chat);
  await storage.save(chat);
  expect(store.get().chats ?? []).toEqual([]);
  await storage.addSummary(chat);
  expect(store.get().chats).toHaveLength(1);
});

it("puts right a summary a crash left behind its thread", async () => {
  const chat = thread();
  await storage.add(chat);
  const stale = thread();
  await storage.add(stale);
  // Their files moved on, and the process died before the store heard.
  chat.title = "Renamed before the crash";
  chat.messages.push(answer("Done"));
  stale.title = "Also renamed";
  await storage.save(chat, { holdSummary: true });
  await storage.save(stale, { holdSummary: true });
  await store.flush();
  expect(listed(chat).title).toBe("Thread");

  await open();
  const old = new Date(Date.now() - 3_600_000);
  // Written long before the store was, so the store can't have missed it.
  await utimes(join(root, "chats", stale.id + ".json"), old, old);
  await storage.reconcile(store.savedAtLoad);

  expect(listed(chat)).toMatchObject({
    title: "Renamed before the crash",
    provider: "codex",
    empty: false,
  });
  expect(listed(stale).title).toBe("Thread");
  expect(changed).toEqual(["p"]);
});
