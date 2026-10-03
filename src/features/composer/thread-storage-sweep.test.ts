import { afterEach, beforeEach, expect, it, vi } from "vitest";

const images = new Map<string, unknown[]>();
vi.mock("../images/draft-images", () => ({
  draftImageKeys: async () => [...images.keys()],
  saveDraftImages: async (key: string, list: unknown[]) => {
    if (list.length) images.set(key, list);
    else images.delete(key);
  },
}));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  images.clear();
  vi.resetModules();
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
afterEach(() => vi.unstubAllGlobals());

// A fresh module each time: it sweeps once per launch.
const sweep = async (
  threads: Record<string, string[]>,
  during?: () => void,
) => {
  const { sweepThreadStorage } = await import("./thread-storage-sweep");
  await sweepThreadStorage({
    projects: async () => Object.keys(threads).map((id) => ({ id })),
    projectChats: async (projectId) => {
      during?.();
      return threads[projectId].map((id) => ({ id }));
    },
  });
};
// What a thread's composers keep: its draft record, with a side conversation
// `r1`, and the settings of both.
const draftRecord = (text = "Hi") =>
  JSON.stringify({
    v: 1,
    ...(text ? { main: { text, skills: { $go: "Go" } } } : {}),
    replies: { r1: { text: "Reply" } },
    replyRoot: "r1",
    scope: { kind: "project" },
  });
const threadKeys = (id: string) => [
  `relay-draft:${id}`,
  `composer-settings:${id}`,
  `composer-settings:${id}:r1`,
];
const seed = (keys: string[], text?: string) => {
  for (const key of keys)
    store.set(key, key.startsWith("relay-draft:") ? draftRecord(text) : "{}");
};
const unrelated = [
  "theme",
  "relay-thread-panes",
  "composer-models:new-thread",
  "relay-project-id",
];

it("drops every key of a thread that's gone and keeps the live ones'", async () => {
  seed([...threadKeys("gone"), ...threadKeys("live"), ...unrelated]);
  images.set("chat-draft:gone", [{}]);
  images.set("chat-draft:live:r1", [{}]);
  await sweep({ p1: ["live"] });
  expect([...store.keys()].sort()).toEqual(
    [...threadKeys("live"), ...unrelated].sort(),
  );
  expect(store.get("relay-draft:live")).toBe(draftRecord());
  expect([...images.keys()]).toEqual(["chat-draft:live:r1"]);
});

it("moves drafts kept key by key into records before it sweeps, dropping a gone thread's and keeping the live one's", async () => {
  for (const id of ["gone", "live"]) {
    store.set(`chat-draft:${id}`, "Hi");
    store.set(`chat-draft:${id}:r1`, "Reply");
    store.set(`chat-reply:${id}`, "r1");
    store.set(`skill-chips:chat-draft:${id}`, '{"$go":"Go"}');
    store.set(`pasted-texts:chat-draft:${id}`, "[]");
    store.set(`composer-settings:${id}`, "{}");
  }
  seed([], "");
  store.set("theme", "dark");
  await sweep({ p1: ["live"] });
  expect([...store.keys()].sort()).toEqual([
    "composer-settings:live",
    "relay-draft:live",
    "theme",
  ]);
  expect(JSON.parse(store.get("relay-draft:live")!)).toEqual({
    v: 1,
    main: { text: "Hi", skills: { $go: "Go" } },
    replies: { r1: { text: "Reply" } },
    replyRoot: "r1",
  });
});

it("drops a new-thread slot left empty, keeping the base, the open slot and slots with text", async () => {
  const base = "new:p1",
    abandoned = "new:p1:a",
    open = "new:p1:b",
    written = "new:p1:c";
  const unsent = (id: string) => [
    `relay-draft:${id}`,
    `composer-settings:${id}`,
  ];
  seed([base, abandoned, open].flatMap(unsent), "");
  seed(unsent(written));
  store.set("relay-new-thread:p1", open);
  images.set("chat-draft:" + abandoned, [{}]);
  await sweep({ p1: [] });
  const left = [...store.keys()];
  expect(left.filter((k) => k.includes(":p1:a"))).toEqual([]);
  for (const id of [base, open, written])
    expect(left).toContain("composer-settings:" + id);
  for (const id of [base, open, written])
    expect(left).toContain("relay-draft:" + id);
  expect(images.size).toBe(0);
});

it("drops what a project that's gone kept, its unsent drafts included", async () => {
  seed(["relay-draft:new:p2", "composer-settings:new:p2"]);
  seed([
    "relay-new-thread:p2",
    "relay-project-chat:p2",
    "relay-project-chat:p1",
  ]);
  await sweep({ p1: [] });
  expect([...store.keys()]).toEqual(["relay-project-chat:p1"]);
});

it("keeps keys written while the threads were being read", async () => {
  seed(threadKeys("live"));
  // A thread made meanwhile that the answer already missed.
  await sweep({ p1: ["live"] }, () =>
    store.set("composer-settings:started", "{}"),
  );
  expect(store.has("composer-settings:started")).toBe(true);
});

it("drops nothing when a thread list can't be read", async () => {
  seed(threadKeys("gone"));
  const { sweepThreadStorage } = await import("./thread-storage-sweep");
  await expect(
    sweepThreadStorage({
      projects: async () => [{ id: "p1" }],
      projectChats: async () => {
        throw new Error("offline");
      },
    }),
  ).rejects.toThrow();
  expect(store.size).toBe(threadKeys("gone").length);
});

it("sweeps once a launch", async () => {
  const { sweepThreadStorage } = await import("./thread-storage-sweep");
  const source = { projects: vi.fn(async () => []), projectChats: vi.fn() };
  await sweepThreadStorage(source);
  await sweepThreadStorage(source);
  expect(source.projects).toHaveBeenCalledTimes(1);
});
