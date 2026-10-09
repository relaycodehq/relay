import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rename, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../app/store";
import { chatSummary, ChatStorage, queueMark } from "./storage";
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

it("lists each answering agent once, most recently used first, including side conversations", () => {
  const chat = thread();
  chat.messages = [
    { ...answer("First"), provider: "claude" },
    { ...answer("Second"), provider: "cursor" },
    { ...answer("Third"), provider: "opencode" },
    { ...answer("Fourth"), provider: "claude", parentId: "side" },
    answer("Working"),
    { ...answer("User message"), role: "user", provider: "cursor" },
  ];
  expect(chatSummary(chat).providers).toEqual([
    "codex",
    "claude",
    "opencode",
    "cursor",
  ]);
  chat.messages = [];
  expect(chatSummary(chat).providers).toEqual([]);
});

it("backfills agent history for older summaries even when the thread file is old", async () => {
  const chat = thread();
  chat.messages = [
    { ...answer("Earlier"), provider: "claude" },
    answer("Latest"),
  ];
  await storage.add(chat);
  await store.update((s) => {
    delete s.chats![0]!.providers;
  });
  await store.flush();
  await open();
  const old = new Date(Date.now() - 3_600_000);
  await utimes(join(root, "chats", chat.id + ".json"), old, old);
  await storage.reconcile(store.savedAtLoad);
  expect(listed(chat).providers).toEqual(["codex", "claude"]);
  expect(changed).toEqual(["p"]);
  changed.length = 0;
  await storage.reconcile(store.savedAtLoad);
  expect(changed).toEqual([]);
});

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

it("tells listeners when only the queue moves, so phones fetch it", async () => {
  const chat = thread();
  chat.messages.push(answer("Working on it"));
  await storage.add(chat);
  expect(listed(chat).queueMark).toBeUndefined();
  const input = (id: string) => ({ ...answer(id), id, body: id }) as never;
  const marks: (string | undefined)[] = [];
  for (const queue of [["a"], ["a", "b"], ["b", "a"], ["b"]]) {
    changed.length = 0;
    chat.queue = queue.map((id) => ({ input: input(id), created: 1 }));
    await storage.save(chat);
    expect(changed).toEqual(["p"]);
    marks.push(listed(chat).queueMark);
  }
  expect(new Set(marks).size).toBe(4);

  chat.queue = [];
  await storage.save(chat);
  expect(listed(chat).queueMark).toBeUndefined();
});

it("changes the queue mark for pause, errors and schedules, but stays quiet during streaming", async () => {
  const chat = thread();
  chat.messages.push(answer("Working"));
  const input = {
    id: "queued",
    body: "Next",
    images: [{ dataUrl: "large screenshot" }],
  } as never;
  chat.queue = [{ input, created: 1 }];
  await storage.add(chat);
  const initial = queueMark(chat);
  changed.length = 0;
  const update = vi.spyOn(store, "update");
  chat.messages[0].body += " token";
  chat.messages[0].version++;
  await storage.save(chat);
  expect(queueMark(chat)).toBe(initial);
  expect(changed).toEqual([]);
  expect(update).not.toHaveBeenCalled();

  const marks = [initial];
  chat.queuePaused = true;
  marks.push(queueMark(chat));
  chat.queue[0].error = "Couldn't send";
  marks.push(queueMark(chat));
  chat.scheduled = [{ input, at: 123, created: 1 }];
  marks.push(queueMark(chat));
  chat.scheduled[0].at++;
  marks.push(queueMark(chat));
  chat.scheduled[0].error = "Failed";
  marks.push(queueMark(chat));
  expect(new Set(marks).size).toBe(marks.length);
  delete chat.queue;
  const noQueue = queueMark(chat);
  chat.queue = [];
  expect(queueMark(chat)).toBe(noQueue);
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

it("flush reports a failed cached write and retries it after storage is repaired", async () => {
  const chat = thread();
  await storage.add(chat);
  const path = join(root, "chats", chat.id + ".json");
  await rename(path, path + ".backup");
  await mkdir(path);
  chat.title = "Keep this unsaved title";
  await expect(storage.save(chat)).rejects.toThrow();
  expect(storage.busy().writes).toEqual([]);
  // An empty queue does not mean the cached data was saved successfully.
  await expect(storage.flush()).rejects.toThrow();
  await rm(path, { recursive: true });
  await rename(path + ".backup", path);
  await storage.flush();
  expect(JSON.parse(await readFile(path, "utf8")).title).toBe(chat.title);
  expect(listed(chat).title).toBe(chat.title);
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

it("derives open questions from messages, clearing the flag after answers or dismissals", () => {
  const chat = thread();
  const group = { id: "ask", questions: [{ id: "q", question: "Which?" }] };
  chat.messages = [
    { ...answer("Question"), questions: [group], parentId: "side" },
  ];
  expect(chatSummary(chat).asking).toBe(true);
  chat.asking = true; // A loaded or forked summary is never the source of truth.
  chat.messages[0].questions![0].dismissed = true;
  expect(chatSummary(chat).asking).toBeUndefined();
  delete chat.messages[0].questions![0].dismissed;
  chat.messages[0].questions![0].answers = { q: ["This"] };
  expect(chatSummary(chat).asking).toBeUndefined();
});
