import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let refuse: (key: string) => boolean = () => false;
beforeEach(() => {
  store.clear();
  refuse = () => false;
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (refuse(key)) throw new DOMException("full", "QuotaExceededError");
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

// A fresh module each time: drafts move to records once a launch.
const storage = () => import("./thread-storage");
const recordOf = (thread: string) =>
  JSON.parse(store.get("relay-draft:" + thread) ?? "null");

const oldKeys = () => {
  store.set("chat-draft:c1", "Hello $go");
  store.set("chat-draft:c1:r1", "Reply");
  store.set("chat-reply:c1", "r1");
  store.set("skill-chips:chat-draft:c1", '{"$go":"Go"}');
  store.set("quote-chips:chat-draft:c1:r1", '["> q"]');
  store.set("composer-settings:c1", '{"agent":"codex"}');
  store.set("theme", "dark");
};
const draftKeys = () =>
  [...store.keys()].filter((k) =>
    /^(chat-|skill-|quote-|file-|pasted-|relay-draft)/.test(k),
  );

describe("drafts kept key by key", () => {
  it("move into one record on first read, and the old keys go once it is written", async () => {
    oldKeys();
    const { readDraftText, draftChips } = await storage();
    expect(readDraftText("chat-draft:c1")).toBe("Hello $go");
    expect(readDraftText("chat-draft:c1:r1")).toBe("Reply");
    expect(draftChips("chat-draft:c1").skills.load()).toEqual({ $go: "Go" });
    expect(draftChips("chat-draft:c1:r1").quotes.load()).toEqual(["> q"]);
    expect(draftKeys()).toEqual(["relay-draft:c1"]);
    expect(recordOf("c1")).toEqual({
      v: 1,
      main: { text: "Hello $go", skills: { $go: "Go" } },
      replies: { r1: { text: "Reply", quotes: ["> q"] } },
      replyRoot: "r1",
    });
    // What isn't part of a draft stays.
    expect(store.get("composer-settings:c1")).toBe('{"agent":"codex"}');
    expect(store.get("theme")).toBe("dark");
  });

  it("stay where they are, and stay readable, when the record can't be written", async () => {
    oldKeys();
    refuse = (key) => key.startsWith("relay-draft:");
    const { readDraftText, writeDraftText, draftKeysWithText } =
      await storage();
    expect(readDraftText("chat-draft:c1")).toBe("Hello $go");
    expect(store.get("chat-draft:c1")).toBe("Hello $go");
    expect(store.has("relay-draft:c1")).toBe(false);
    // Typing goes on, kept in memory, and lists as a draft.
    writeDraftText("chat-draft:c1", "Hello $go, edited");
    expect(readDraftText("chat-draft:c1")).toBe("Hello $go, edited");
    expect(draftKeysWithText().sort()).toEqual([
      "chat-draft:c1",
      "chat-draft:c1:r1",
    ]);
    expect(store.get("chat-draft:c1")).toBe("Hello $go");
    // Once storage takes it, the record is written and the old keys go.
    refuse = () => false;
    writeDraftText("chat-draft:c1", "Hello $go, edited again");
    expect(draftKeys()).toEqual(["relay-draft:c1"]);
    expect(recordOf("c1").main.text).toBe("Hello $go, edited again");
    expect(recordOf("c1").replies.r1.text).toBe("Reply");
  });

  it("merge into a record an older build left them beside, theirs winning", async () => {
    store.set(
      "relay-draft:c1",
      JSON.stringify({
        v: 1,
        main: { text: "stale", quotes: ["kept"] },
        selection: {
          head: "a".repeat(40),
          base: "a".repeat(40),
          path: "a.ts",
          start: 1,
          end: 1,
          side: "additions",
          question: "Q",
        },
      }),
    );
    store.set("chat-draft:c1", "typed in the older build");
    const { readDraftText, threadStorage, draftChips } = await storage();
    expect(readDraftText("chat-draft:c1")).toBe("typed in the older build");
    expect(draftChips("chat-draft:c1").quotes.load()).toEqual(["kept"]);
    expect(threadStorage("c1").selection.load()?.question).toBe("Q");
    expect(draftKeys()).toEqual(["relay-draft:c1"]);
  });

  it("keep what is readable of a garbled part and drop the rest", async () => {
    store.set("chat-draft:c1", "Typed");
    store.set("skill-chips:chat-draft:c1", "{garbled");
    store.set("chat-selection:c1", "[1");
    store.set("file-chips:chat-draft:c1", '["a.ts"]');
    const { readDraftText, draftChips, threadStorage } = await storage();
    expect(readDraftText("chat-draft:c1")).toBe("Typed");
    expect(draftChips("chat-draft:c1").files.load()).toEqual(["a.ts"]);
    expect(draftChips("chat-draft:c1").skills.load()).toEqual({});
    expect(threadStorage("c1").selection.load()).toBeUndefined();
    expect(draftKeys()).toEqual(["relay-draft:c1"]);
  });

  it("carry an unsent thread's scope and workspace into its record", async () => {
    store.set("relay-draft-scope:p1:s", '{"kind":"review"}');
    store.set("relay-draft-workspace:p1:s", "worktree");
    const { threadStorage } = await storage();
    const unsent = threadStorage("new:p1:s");
    expect(unsent.scope.load()).toEqual({ kind: "review" });
    expect(unsent.workspace.load("checkout")).toBe("worktree");
    expect(draftKeys()).toEqual(["relay-draft:new:p1:s"]);
  });

  it("leave nothing behind when they held nothing", async () => {
    store.set("chat-selection:c1", "garbage");
    const { readDraftText } = await storage();
    expect(readDraftText("chat-draft:c1")).toBe("");
    expect(draftKeys()).toEqual([]);
  });
});

describe("the record", () => {
  it("is written whole: the text and its pills together", async () => {
    const { writeDraftText, draftChips } = await storage();
    writeDraftText("chat-draft:c1", "Run $go");
    draftChips("chat-draft:c1").skills.save({ $go: "Go" });
    expect(draftKeys()).toEqual(["relay-draft:c1"]);
    expect(recordOf("c1").main).toEqual({
      text: "Run $go",
      skills: { $go: "Go" },
    });
  });

  it("keeps the pills when the text goes, and goes itself with the last part", async () => {
    const { writeDraftText, draftChips, readDraftText } = await storage();
    writeDraftText("chat-draft:c1", "Run $go");
    draftChips("chat-draft:c1").skills.save({ $go: "Go" });
    writeDraftText("chat-draft:c1", "");
    expect(readDraftText("chat-draft:c1")).toBe("");
    expect(draftChips("chat-draft:c1").skills.load()).toEqual({ $go: "Go" });
    draftChips("chat-draft:c1").skills.save({});
    expect(store.has("relay-draft:c1")).toBe(false);
  });

  it("keeps a side conversation's draft apart from the main one's", async () => {
    const { writeDraftText, draftChips, readDraftText } = await storage();
    writeDraftText("chat-draft:c1", "Main");
    writeDraftText("chat-draft:c1:r1", "Side");
    draftChips("chat-draft:c1:r1").files.save(["a.ts"]);
    expect(readDraftText("chat-draft:c1")).toBe("Main");
    expect(draftChips("chat-draft:c1").files.load()).toEqual([]);
    expect(recordOf("c1").replies.r1).toEqual({
      text: "Side",
      files: ["a.ts"],
    });
  });

  it("lists the composers with text, whichever way they were kept", async () => {
    store.set("chat-draft:old", "kept the old way");
    store.set("chat-draft:blank", "  \n");
    const { writeDraftText, draftKeysWithText } = await storage();
    writeDraftText("chat-draft:c1", "Main");
    writeDraftText("chat-draft:c1:r1", "Side");
    writeDraftText("chat-draft:new:p1:s", "Unsent");
    writeDraftText("chat-draft:c2", " ");
    expect(draftKeysWithText().sort()).toEqual([
      "chat-draft:c1",
      "chat-draft:c1:r1",
      "chat-draft:new:p1:s",
      "chat-draft:old",
    ]);
  });

  it("moves a draft's text and pills to another thread in one piece", async () => {
    const { writeDraftText, draftChips, moveDraftBody, readDraftText } =
      await storage();
    writeDraftText("chat-draft:new:p1", "Run $go");
    draftChips("chat-draft:new:p1").skills.save({ $go: "Go" });
    moveDraftBody("chat-draft:new:p1", "chat-draft:c9");
    expect(readDraftText("chat-draft:new:p1")).toBe("");
    expect(readDraftText("chat-draft:c9")).toBe("Run $go");
    expect(draftChips("chat-draft:c9").skills.load()).toEqual({ $go: "Go" });
    expect(draftChips("chat-draft:new:p1").skills.load()).toEqual({});
  });

  it("forgets a thread's draft and says which composers had text", async () => {
    const { writeDraftText, removeThreadDraft, threadStorage } =
      await storage();
    writeDraftText("chat-draft:c1", "Main");
    writeDraftText("chat-draft:c1:r1", "Side");
    threadStorage("c1").reply.save("r1");
    expect(removeThreadDraft("c1").sort()).toEqual([
      "chat-draft:c1",
      "chat-draft:c1:r1",
    ]);
    expect(store.size).toBe(0);
  });

  it("holds what a thread's composer attached, and clears it with the message", async () => {
    const { threadStorage } = await storage();
    const ref = { path: "a.ts", start: 1, end: 2, label: "HEAD", code: "x" };
    const thread = threadStorage("c1");
    thread.codeRefs.save([ref]);
    thread.workspace.save("worktree", "checkout");
    expect(threadStorage("c1").codeRefs.load()).toEqual([ref]);
    expect(thread.workspace.load("checkout")).toBe("worktree");
    // Picking what the project already does is no pick.
    thread.workspace.save("checkout", "checkout");
    expect(thread.workspace.load("worktree")).toBe("worktree");
    thread.codeRefs.clear();
    expect(store.has("relay-draft:c1")).toBe(false);
    expect(thread.scope.load()).toEqual({ kind: "project" });
  });

  it("reads one that is garbled as no draft, and writes over it", async () => {
    store.set("relay-draft:c1", "{truncated");
    const { readDraftText, writeDraftText } = await storage();
    expect(readDraftText("chat-draft:c1")).toBe("");
    writeDraftText("chat-draft:c1", "Again");
    expect(recordOf("c1").main.text).toBe("Again");
  });
});

describe("whose a key is", () => {
  it("knows the record, and the keys it replaces", async () => {
    const { keyOwner } = await storage();
    expect(keyOwner("relay-draft:c1")).toEqual({ thread: "c1" });
    expect(keyOwner("relay-draft:new:p1:s")).toEqual({ thread: "new:p1:s" });
    expect(keyOwner("relay-draft:")).toBeUndefined();
    expect(keyOwner("chat-draft:c1:r1")).toEqual({ thread: "c1" });
    expect(keyOwner("skill-chips:chat-draft:new:p1")).toEqual({
      thread: "new:p1",
    });
    expect(keyOwner("relay-draft-scope:p1:s")).toEqual({ thread: "new:p1:s" });
    expect(keyOwner("composer-settings:c1:r1")).toEqual({ thread: "c1" });
    expect(keyOwner("relay-new-thread:p1")).toEqual({ project: "p1" });
    expect(keyOwner("theme")).toBeUndefined();
  });
});
