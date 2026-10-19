import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  applyDraftWrite,
  type DraftChange,
  type DraftDevice,
  type DraftWrite,
  type SharedDraft,
} from "../../../shared/drafts";
import type { DraftImage } from "../images/draft-images";

// The main process, as far as this window sees it: the real merge rules over a map.
const main = new Map<string, SharedDraft>();
let rev = 0;
const writes: DraftWrite[] = [];
let hear: ((change: DraftChange) => void) | undefined;
let readShared = async () => [...main.values()];
function take(write: DraftWrite, by: DraftDevice) {
  const { draft, changed } = applyDraftWrite(main.get(write.key), write, by, () => ++rev);
  if (draft) main.set(write.key, draft);
  else main.delete(write.key);
  return { draft, changed };
}
/** A phone writes, and the main process tells this window. */
function phone(write: Omit<DraftWrite, "base" | "at"> & { at?: number }) {
  const { draft, changed } = take(
    { base: main.get(write.key)?.rev ?? 0, at: Date.now(), ...write },
    "phone:p1",
  );
  if (changed)
    hear?.({ key: write.key, draft, ...(write.sent !== undefined && !draft ? { sent: true as const } : {}) });
}

const images = new Map<string, DraftImage[]>();
const saved = new Set<(key: string, list: DraftImage[]) => void>();
vi.mock("../images/draft-images", () => ({
  loadDraftImages: async (key: string) => images.get(key) ?? [],
  saveDraftImages: async (key: string, list: DraftImage[]) => {
    images.set(key, list);
    saved.forEach((listener) => listener(key, list));
  },
  draftImageKeys: async () => [...images.keys()],
  onDraftImagesSaved: (listener: (key: string, list: DraftImage[]) => void) => {
    saved.add(listener);
    return () => saved.delete(listener);
  },
  onDraftImagesChanged: () => () => {},
  draftImageCount: () => 0,
  draftsWithImages: () => [],
  readDraftImageCounts: async () => {},
  onDraftImageCount: () => () => {},
}));
vi.mock("../../lib/api", () => ({
  api: {
    sharedDrafts: () => readShared(),
    writeSharedDrafts: async (list: DraftWrite[]) =>
      list.map((write) => {
        writes.push(write);
        return take(write, "desktop").draft;
      }),
    onSharedDraft: (listener: (change: DraftChange) => void) => {
      hear = listener;
      return () => {};
    },
    sharedDraftOther: async () => null,
  },
}));

const store = new Map<string, string>();
const chat = "chat-1";
const key = `chat-draft:${chat}`;
let sync: typeof import("./draft-sync");
let drafts: typeof import("./drafts");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(1_000_000);
  store.clear();
  images.clear();
  saved.clear();
  main.clear();
  writes.length = 0;
  rev = 0;
  hear = undefined;
  readShared = async () => [...main.values()];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  vi.stubGlobal("window", { addEventListener() {} });
  vi.resetModules();
  sync = await import("./draft-sync");
  drafts = await import("./drafts");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start() {
  sync.startDraftSync({ takes: true });
  await vi.advanceTimersByTimeAsync(0);
}
const pause = () => vi.advanceTimersByTimeAsync(400);

function delaySnapshot() {
  let finish!: (drafts: SharedDraft[]) => void;
  const pending = new Promise<SharedDraft[]>((resolve) => { finish = resolve; });
  readShared = () => pending;
  return async (list: SharedDraft[]) => {
    finish(list);
    await vi.advanceTimersByTimeAsync(0);
  };
}

it("shares what's typed once the typing pauses", async () => {
  await start();
  drafts.writeDraft(key, "Fix");
  drafts.writeDraft(key, "Fix the login");
  expect(writes).toEqual([]);
  await pause();
  expect(writes).toMatchObject([{ key: chat, text: "Fix the login", base: 0 }]);
  expect(main.get(chat)).toMatchObject({ origin: "desktop", rev: 1 });
});

it("keeps a draft synced while the initial snapshot was still arriving", async () => {
  const finish = delaySnapshot();
  await start();
  drafts.writeDraft(key, "Words dictated while the draft list loads");
  await pause();
  expect(main.get(chat)?.text).toBe(
    "Words dictated while the draft list loads",
  );
  await finish([]);
  expect(drafts.readDraft(key)).toBe(
    "Words dictated while the draft list loads",
  );
});

it("keeps a newer live edit instead of the initial snapshot's older text", async () => {
  take({ key: chat, text: "Old words", base: 0, at: 1 }, "phone:p1");
  const snapshot = [...main.values()];
  const finish = delaySnapshot();
  await start();
  phone({ key: chat, text: "The complete dictated message" });
  await finish(snapshot);
  expect(drafts.readDraft(key)).toBe("The complete dictated message");
  await pause();
  expect(writes).toEqual([]);
});

it("doesn't restore a draft sent while the initial snapshot was arriving", async () => {
  take({ key: chat, text: "Already sent", base: 0, at: 1 }, "phone:p1");
  const snapshot = [...main.values()];
  const finish = delaySnapshot();
  await start();
  phone({ key: chat, text: "", sent: "Already sent" });
  await finish(snapshot);
  expect(drafts.readDraft(key)).toBe("");
  await pause();
  expect(writes).toEqual([]);
});

it("puts a phone's edit in the composer and doesn't send it back", async () => {
  await start();
  phone({ key: chat, text: "From the couch" });
  expect(drafts.readDraft(key)).toBe("From the couch");
  await pause();
  expect(writes).toEqual([]);
});

it("keeps a phone's edit out of a composer being typed in; the later edit wins, the other a tap away", async () => {
  await start();
  drafts.writeDraft(key, "Typed here");
  vi.setSystemTime(999_000);
  phone({ key: chat, text: "Typed on the phone", at: 999_000 });
  expect(drafts.readDraft(key)).toBe("Typed here");
  vi.setSystemTime(1_001_000);
  await pause();
  expect(main.get(chat)).toMatchObject({
    text: "Typed here",
    other: { text: "Typed on the phone", by: "phone:p1" },
  });
  expect(drafts.readDraft(key)).toBe("Typed here");
});

it("empties a draft sent from the phone and marks it sent, for Activity", async () => {
  await start();
  phone({ key: chat, text: "Ship it" });
  phone({ key: chat, text: "", sent: "Ship it" });
  expect(drafts.readDraft(key)).toBe("");
  expect(drafts.draftSentAt(chat)).toBe(Date.now());
});

it("tells the computer a send from here went, not that it was cleared", async () => {
  await start();
  drafts.writeDraft(key, "Ship it");
  await pause();
  drafts.markDraftSent(chat);
  drafts.writeDraft(key, "");
  await pause();
  expect(writes.at(-1)).toMatchObject({ key: chat, text: "", sent: "Ship it" });
  expect(main.has(chat)).toBe(false);
});

it("lines up on start: pushes a draft from before sharing, takes a phone's", async () => {
  store.set(`relay-draft:${chat}`, JSON.stringify({ v: 1, main: { text: "Only here" } }));
  take({ key: "chat-2", text: "From the phone", base: 0, at: 1 }, "phone:p1");
  await start();
  await pause();
  expect(main.get(chat)).toMatchObject({ text: "Only here", origin: "desktop" });
  expect(drafts.readDraft("chat-draft:chat-2")).toBe("From the phone");
});

it("drops on start what was sent elsewhere while this window was closed", async () => {
  await start();
  drafts.writeDraft(key, "Ship it");
  await pause();
  main.delete(chat);
  vi.resetModules();
  sync = await import("./draft-sync");
  drafts = await import("./drafts");
  await start();
  expect(drafts.readDraft(key)).toBe("");
});

it("counts a screenshot as the desktop's part of a draft", async () => {
  await start();
  const { saveDraftImages } = await import("../images/draft-images");
  await saveDraftImages(key, [
    { id: "s1", name: "shot.png", mimeType: "image/png", dataUrl: "data:," },
  ]);
  await pause();
  expect(main.get(chat)).toMatchObject({ text: "", extras: { screenshots: [0] } });
});

it("counts a new thread's picked worktree start as the desktop's part", async () => {
  await start();
  const { threadStorage } = await import("../../lib/thread-storage");
  threadStorage("new:p1").start.save({ on: "feature" });
  drafts.writeDraft("chat-draft:new:p1", "Carry it on");
  await pause();
  expect(main.get("new:p1")).toMatchObject({ extras: { start: true } });
});
