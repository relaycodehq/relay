// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, update } from "../../../tests/unit/hook-harness";
import {
  activityDrafts,
  draftSentAt,
  markDraftSent,
  useDraft,
  currentNewThread,
  freshNewThread,
  forgetNewThread,
  loadDraftScope,
  newThreadId,
  resetDraftScope,
  reviewDraftIn,
  saveDraftScope,
  setCurrentNewThread,
  updateReviewDraft,
  useDraftKeys,
  writeDraft,
} from "./drafts";
import { threadStorage, writeDraftText } from "../../lib/thread-storage";
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
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
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

const pr = {
  kind: "pr" as const,
  ref: { owner: "relay", name: "relay", number: 7 },
};

it("clears what abandoned empty slots left behind", () => {
  const base = newThreadId("p1");
  const empty = newThreadId("p1", "a");
  const kept = newThreadId("p1", "b");
  type(base, "First idea");
  type(kept, "Second idea");
  for (const id of [empty, kept]) {
    store.set("composer-settings:" + id, "{}");
    saveDraftScope(id, pr);
    threadStorage(id).reply.save("r1");
  }
  setCurrentNewThread("p1", kept);
  freshNewThread("p1");
  expect(store.has("composer-settings:" + empty)).toBe(false);
  expect(store.has("relay-draft:" + empty)).toBe(false);
  expect(store.has("composer-settings:" + kept)).toBe(true);
  expect(loadDraftScope(kept)).toEqual(pr);
  expect(loadDraftScope(empty)).toEqual({ kind: "project" });
});

it("keeps a deep review set up without text as a draft, and sets it aside once it isn't one", () => {
  const review = newThreadId("p1");
  saveDraftScope(review, { kind: "review" });
  // Only opened, it's no draft yet.
  expect(freshNewThread("p1")).toBe(review);
  const keys = mount(useDraftKeys);
  expect(keys()).toEqual([]);
  update(() => updateReviewDraft(review, { head: "feature", base: "main" }));
  expect(freshNewThread("p1")).not.toBe(review);
  expect(reviewDraftIn("p1")).toBe(review);
  const project = { id: "p1", name: "Relay" } as Project;
  expect(activityDrafts(keys(), new Map([["p1", project]]), new Map())).toEqual(
    [{ key: "chat-draft:" + review, id: review, project, reply: false }],
  );
  update(() => saveDraftScope(review, { kind: "project" }));
  expect(freshNewThread("p1")).toBe(review);
  expect(reviewDraftIn("p1")).toBeUndefined();
  // A fresh thread in the slot, as navigating starts one, leaves it set aside.
  update(() => resetDraftScope(review));
  // Back on Deep review, the picks are still there.
  update(() => saveDraftScope(review, { kind: "review" }));
  expect(threadStorage(review).review.load()).toMatchObject({
    head: "feature",
    base: "main",
  });
  expect(reviewDraftIn("p1")).toBe(review);
});

it("opens the project's most recently changed review draft again", () => {
  const now = vi.spyOn(Date, "now");
  const slot = newThreadId("p1", "a");
  const base = newThreadId("p1");
  for (const [id, at] of [
    [slot, 1],
    [base, 2],
  ] as const) {
    now.mockReturnValue(at);
    saveDraftScope(id, { kind: "review" });
    updateReviewDraft(id, { focus: "queue" });
  }
  setCurrentNewThread("p1", newThreadId("p1", "b"));
  expect(reviewDraftIn("p1")).toBe(base);
  now.mockReturnValue(3);
  updateReviewDraft(slot, { focus: "panel" });
  expect(reviewDraftIn("p1")).toBe(slot);
  now.mockRestore();
});

it("ignores a saved new thread from another project", () => {
  setCurrentNewThread("p1", newThreadId("p2", "x"));
  expect(currentNewThread("p1")).toBe(newThreadId("p1"));
});

it("lists one draft per thread, the open thread's too", () => {
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
  const drafts = activityDrafts(keys, new Map([["p1", project]]), chats).map(
    ({ key, id, reply }) => ({ key, id, reply }),
  );
  expect(drafts).toEqual([
    { key: "chat-draft:c1", id: "c1", reply: false },
    { key: "chat-draft:c2:reply", id: "c2", reply: true },
    { key: "chat-draft:c3", id: "c3", reply: false },
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

it("hears a draft written, then sent, in a thread's own window", () => {
  const keys = mount(useDraftKeys);
  let renders = 0;
  const text = mount(() => {
    renders++;
    return useDraft("chat-draft:t1");
  });
  const heard = (thread: string) =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: "relay-draft:" + thread }),
    );
  expect(keys()).toEqual([]);
  expect(text()).toBe("");
  const initialRenders = renders;
  // Write the record without this window's feature notifications, as another
  // window does. Only its storage event should update the mounted hooks.
  writeDraftText("chat-draft:t1", "Half-written question");
  expect(text()).toBe("");
  update(() => heard("t1"));
  expect(keys()).toEqual(["chat-draft:t1"]);
  expect(text()).toBe("Half-written question");
  expect(renders).toBe(initialRenders + 1);

  markDraftSent("t1");
  writeDraftText("chat-draft:t1", "");
  update(() => heard("t1"));
  expect(text()).toBe("");
  expect(keys()).toEqual([]);
  expect(draftSentAt("t1")).toBeGreaterThan(0);
  expect(renders).toBe(initialRenders + 2);
});

it("switches draft subscriptions to the new key and releases them on unmount", () => {
  type("t1", "First draft");
  type("t2", "Second draft");
  let key = "chat-draft:t1",
    renders = 0;
  const text = mount(() => {
    renders++;
    return useDraft(key);
  });
  expect(text()).toBe("First draft");
  update(() => type("t1", "Edited first"));
  expect(text()).toBe("Edited first");
  key = "chat-draft:t2";
  text.rerender();
  expect(text()).toBe("Second draft");
  const switchedRenders = renders;
  update(() => type("t1", "Old key changed"));
  expect(renders).toBe(switchedRenders);
  expect(text()).toBe("Second draft");
  update(() => type("t2", "Edited second"));
  expect(text()).toBe("Edited second");
  text.unmount();
  const unmountedRenders = renders;
  update(() => type("t2", "After unmount"));
  expect(renders).toBe(unmountedRenders);
});

it("updates the mounted draft index only when draft membership changes", () => {
  let renders = 0;
  const keys = mount(() => {
    renders++;
    return useDraftKeys();
  });
  expect(keys()).toEqual([]);
  update(() => type("t1", "First character"));
  expect(keys()).toEqual(["chat-draft:t1"]);
  const indexedRenders = renders;
  update(() => type("t1", "More typing"));
  expect(renders).toBe(indexedRenders);
  update(() => type("t1", ""));
  expect(keys()).toEqual([]);
  keys.unmount();
  const unmountedRenders = renders;
  update(() => type("t2", "New after unmount"));
  expect(renders).toBe(unmountedRenders);
});
