import { beforeEach, expect, it, vi } from "vitest";
import {
  applyDraftWrite,
  type DraftWrite,
  type SharedDraft,
} from "../../../shared/drafts";
import type { RemoteOverview } from "../../../shared/remote";

const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void storage.set(k, v),
    removeItem: async (k: string) => void storage.delete(k),
    getAllKeys: async () => [...storage.keys()],
    multiGet: async (keys: string[]) => keys.map((k) => [k, storage.get(k) ?? null]),
    multiRemove: async (keys: string[]) => keys.forEach((k) => storage.delete(k)),
  },
}));
vi.mock("react", () => ({
  useSyncExternalStore: (_: unknown, get: () => unknown) => get(),
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
}));

// The computer: the real merge rules over a map.
const main = new Map<string, SharedDraft>();
let rev = 0;
const saves: DraftWrite[] = [];
let offline = false;
const call = (async (method: string, ...args: unknown[]) => {
  if (offline) throw new Error("Not connected");
  if (method !== "saveDraft") throw new Error(`unexpected ${method}`);
  const write = args[0] as DraftWrite;
  saves.push(write);
  const { draft } = applyDraftWrite(main.get(write.key), write, "phone:me", () => ++rev);
  if (draft) main.set(write.key, draft);
  else main.delete(write.key);
  return draft;
}) as never;
const overview = (bridge = 19): RemoteOverview =>
  ({ name: "Studio", bridge, projects: [], chats: [], drafts: [...main.values()] }) as RemoteOverview;
const desktop = (key: string, text: string, at = Date.now()) => {
  const { draft } = applyDraftWrite(
    main.get(key),
    { key, text, base: main.get(key)?.rev ?? 0, at },
    "desktop",
    () => ++rev,
  );
  if (draft) main.set(key, draft);
  return draft!;
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const pause = () => new Promise((r) => setTimeout(r, 450));

const pc = "computer-1";
const chat = "chat-1";
let drafts: typeof import("./drafts");
beforeEach(async () => {
  storage.clear();
  main.clear();
  saves.length = 0;
  rev = 0;
  offline = false;
  vi.resetModules();
  drafts = await import("./drafts");
  drafts.draftsDevice(pc, "me");
});

it("keeps what's typed offline and sends it once the computer is back", async () => {
  drafts.editDraft(pc, chat, { text: "On the train" });
  await pause();
  expect(saves).toEqual([]);
  await drafts.draftsOnline(pc, call, overview());
  await settle();
  expect(main.get(chat)).toMatchObject({ text: "On the train", origin: "phone:me" });
});

it("takes the computer's drafts on connecting and drops the ones gone there", async () => {
  await drafts.draftsOnline(pc, call, overview());
  drafts.editDraft(pc, "gone", { text: "Sent from the Mac later" });
  await pause();
  main.delete("gone");
  desktop(chat, "Started on the Mac");
  drafts.draftsOffline(pc);
  await drafts.draftsOnline(pc, call, overview());
  expect(drafts.draftText(pc, chat)).toBe("Started on the Mac");
  expect(drafts.draftText(pc, "gone")).toBe("");
  expect(drafts.useDrafts(pc).get(chat)).toMatchObject({ from: "computer" });
});

it("lets the later edit win after editing offline, keeping the other a tap away", async () => {
  await drafts.draftsOnline(pc, call, overview());
  drafts.editDraft(pc, chat, { text: "first" });
  await pause();
  drafts.draftsOffline(pc);
  offline = true;
  drafts.editDraft(pc, chat, { text: "edited on the phone, offline" });
  // The Mac edits a bit later, while the phone can't hear it.
  desktop(chat, "edited on the Mac", Date.now() + 1000);
  offline = false;
  await drafts.draftsOnline(pc, call, overview());
  await settle();
  expect(main.get(chat)).toMatchObject({
    text: "edited on the Mac",
    other: { text: "edited on the phone, offline" },
  });
  expect(drafts.draftText(pc, chat)).toBe("edited on the Mac");
});

it("doesn't let the computer's change replace what's being typed here", async () => {
  await drafts.draftsOnline(pc, call, overview());
  drafts.editDraft(pc, chat, { text: "typing" });
  const draft = desktop(chat, "from the Mac");
  drafts.draftHeard(pc, { key: chat, draft });
  expect(drafts.draftText(pc, chat)).toBe("typing");
});

it("takes the computer's change when nothing's being typed", async () => {
  await drafts.draftsOnline(pc, call, overview());
  drafts.draftHeard(pc, { key: chat, draft: desktop(chat, "from the Mac") });
  expect(drafts.draftText(pc, chat)).toBe("from the Mac");
});

it("tells the computer what a send from here took", async () => {
  await drafts.draftsOnline(pc, call, overview());
  drafts.editDraft(pc, chat, { text: "Ship it" });
  await pause();
  drafts.holdDraft(pc, chat);
  // The composer empties as it sends; that isn't an edit.
  drafts.editDraft(pc, chat, { text: "" });
  drafts.draftWent(pc, chat, "Ship it", false);
  await settle();
  expect(saves.at(-1)).toMatchObject({ text: "", sent: "Ship it" });
  expect(main.has(chat)).toBe(false);
});

it("hides a draft sent through the computer until it drops it", async () => {
  await drafts.draftsOnline(pc, call, overview());
  drafts.draftHeard(pc, { key: chat, draft: desktop(chat, "With a screenshot") });
  drafts.holdDraft(pc, chat);
  drafts.draftWent(pc, chat, "With a screenshot", true);
  expect(drafts.useDrafts(pc).has(chat)).toBe(false);
  // The composer, emptied by the send, isn't handed the text back.
  expect(drafts.draftText(pc, chat)).toBe("");
  drafts.editDraft(pc, chat, { text: "" });
  await pause();
  expect(saves).toEqual([]);
  // Its own change on the way doesn't bring it back.
  drafts.draftHeard(pc, { key: chat, draft: desktop(chat, "With a screenshot!") });
  expect(drafts.useDrafts(pc).has(chat)).toBe(false);
  drafts.draftHeard(pc, { key: chat, draft: null, sent: true });
  expect(drafts.draftText(pc, chat)).toBe("");
});

it("keeps drafts on the phone with a computer from before sharing", async () => {
  drafts.editDraft(pc, chat, { text: "Local" });
  await drafts.draftsOnline(pc, call, overview(18));
  await pause();
  expect(saves).toEqual([]);
  expect(drafts.draftText(pc, chat)).toBe("Local");
});

it("adopts the text-only drafts of earlier builds", async () => {
  storage.set("relay-draft:chat-9", "Kept from before");
  vi.resetModules();
  drafts = await import("./drafts");
  drafts.draftsDevice("computer-2", "me");
  await drafts.draftsOnline("computer-2", call, overview());
  expect(drafts.draftText("computer-2", "chat-9")).toBe("Kept from before");
  expect(storage.has("relay-draft:chat-9")).toBe(false);
  await settle();
  expect(main.get("chat-9")).toMatchObject({ text: "Kept from before" });
});

it("starts a fresh new-thread draft per project once the last one went", async () => {
  const first = drafts.newThreadDraftKey(pc, "p1");
  expect(drafts.newThreadDraftKey(pc, "p1")).toBe(first);
  expect(first).toMatch(/^new:p1:[a-z0-9]+$/);
  drafts.editDraft(pc, first, { text: "Build it" });
  drafts.holdDraft(pc, first);
  drafts.draftWent(pc, first, "Build it", false);
  await new Promise((r) => setTimeout(r, 5));
  expect(drafts.newThreadDraftKey(pc, "p1")).not.toBe(first);
});
