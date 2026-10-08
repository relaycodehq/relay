import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  activityDrafts,
  currentNewThread,
  freshNewThread,
  forgetNewThread,
  loadDraftScope,
  newThreadId,
  saveDraftScope,
  setCurrentNewThread,
  writeDraft,
} from "./drafts";
import { threadStorage } from "../../lib/thread-storage";
import type { ChatSummary, Project } from "../../../shared/projects";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const type = (id: string, text: string) => writeDraft("chat-draft:" + id, text);

it("opens a new slot only while the current new thread holds text", () => {
  const base = newThreadId("p1");
  expect(freshNewThread("p1")).toBe(base);
  type(base, "First idea");
  store.set("composer-settings:" + base, '{"runtimeMode":"full-access"}');
  vi.useFakeTimers({ now: 1000 });
  const second = freshNewThread("p1");
  expect(second).toBe(newThreadId("p1", (1000).toString(36)));
  // It starts where the project's new threads are set.
  expect(store.get("composer-settings:" + second)).toBe(
    '{"runtimeMode":"full-access"}',
  );
  setCurrentNewThread("p1", second);
  // Asked again before anything is typed there, it stays put.
  expect(freshNewThread("p1")).toBe(second);
  // Once the first is sent, the base is free again.
  type(base, "");
  type(second, "Second idea");
  expect(freshNewThread("p1")).toBe(base);
});

it("clears what abandoned empty slots left behind", () => {
  const base = newThreadId("p1");
  const empty = newThreadId("p1", "a");
  const kept = newThreadId("p1", "b");
  type(base, "First idea");
  type(kept, "Second idea");
  for (const id of [empty, kept]) {
    store.set("composer-settings:" + id, "{}");
    saveDraftScope(id, { kind: "review" });
    threadStorage(id).reply.save("r1");
  }
  setCurrentNewThread("p1", kept);
  freshNewThread("p1");
  expect(store.has("composer-settings:" + empty)).toBe(false);
  expect(store.has("relay-draft:" + empty)).toBe(false);
  expect(store.has("composer-settings:" + kept)).toBe(true);
  expect(loadDraftScope(kept)).toEqual({ kind: "review" });
  expect(loadDraftScope(empty)).toEqual({ kind: "project" });
});

it("ignores a saved new thread from another project", () => {
  setCurrentNewThread("p1", newThreadId("p2", "x"));
  expect(currentNewThread("p1")).toBe(newThreadId("p1"));
});

it("lists one card per thread and keeps an open new thread's draft", () => {
  const project = { id: "p1", name: "Relay" } as Project;
  const chat = (id: string) => ({ id, projectId: "p1" }) as ChatSummary;
  const chats = new Map(["c1", "c2", "c3"].map((id) => [id, chat(id)]));
  const keys = [
    "chat-draft:c1",
    "chat-draft:c1:reply",
    "chat-draft:c2:reply",
    "chat-draft:c3",
    "chat-draft:gone",
    "chat-draft:new:p1",
    "chat-draft:new:p1:k2",
    "chat-draft:new:other",
  ].sort();
  const drafts = activityDrafts(
    keys,
    new Map([["p1", project]]),
    chats,
    "c3",
  ).map(({ key, id, reply }) => ({ key, id, reply }));
  expect(drafts).toEqual([
    { key: "chat-draft:c1", id: "c1", reply: false },
    { key: "chat-draft:c2:reply", id: "c2", reply: true },
    { key: "chat-draft:new:p1", id: "new:p1", reply: false },
    { key: "chat-draft:new:p1:k2", id: "new:p1:k2", reply: false },
  ]);
});

it("reserves a draft holding only linked folders and clears links after it becomes a thread", () => {
  const base = newThreadId("p1");
  threadStorage(base).links.save([{ path: "/sample/backend", access: "read" }]);
  vi.useFakeTimers({ now: 1000 });
  expect(freshNewThread("p1")).not.toBe(base);
  expect(threadStorage(base).links.load()).toHaveLength(1);
  forgetNewThread(base);
  expect(threadStorage(base).links.load()).toEqual([]);
});
