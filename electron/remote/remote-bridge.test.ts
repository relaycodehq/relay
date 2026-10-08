import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RemoteBridge, toRemoteDiff, type RemoteHost } from "./bridge";
import type { ChatMessage, ChatSummary } from "../../shared/projects";
import type { RemoteDiff, RemoteEvent } from "../../shared/remote";

afterEach(() => vi.useRealTimers());

const chatId = randomUUID(),
  projectId = randomUUID();

function bridge() {
  const events: RemoteEvent[] = [];
  const dispatched: { method: string; args: unknown[] }[] = [];
  const host = {
    projects: async () => [
      { id: projectId, name: "Relay", path: "/r", repository: null, added: 1 },
    ],
    chats: () => [
      {
        id: chatId,
        projectId,
        title: "New chat",
        scope: { kind: "project" as const },
        created: 1,
        updated: 2,
      },
    ],
    dispatch: async (method: string, args: unknown[]) => {
      dispatched.push({ method, args });
      return {
        binary: false,
        old: { name: "a.ts", contents: "one\n", cacheKey: "1" },
        next: { name: "a.ts", contents: "two\n", cacheKey: "2" },
      };
    },
    name: () => "Studio",
  } as unknown as RemoteHost;
  return {
    b: new RemoteBridge(host, (e) => events.push(e)),
    events,
    dispatched,
  };
}

const streaming = (body: string, id = "m1"): ChatMessage => ({
  id,
  role: "assistant",
  body,
  status: "streaming",
  created: 1,
  provider: "codex",
  version: body.length,
});

it("sends a streaming answer at most every 150ms, and its end right away", () => {
  vi.useFakeTimers();
  const { b, events } = bridge();
  for (const body of ["H", "He", "Hel", "Hell"])
    b.chatEvent({ chatId, message: streaming(body) });
  expect(events).toEqual([]);
  vi.advanceTimersByTime(150);
  expect(events.map((e) => e.kind === "message" && e.message.body)).toEqual([
    "Hell",
  ]);

  b.chatEvent({ chatId, message: streaming("Hello") });
  b.chatEvent({
    chatId,
    message: { ...streaming("Hello!"), status: "complete" },
  });
  vi.advanceTimersByTime(500);
  // The held "Hello" never goes out after the finished answer.
  expect(events.map((e) => e.kind === "message" && e.message.body)).toEqual([
    "Hell",
    "Hello!",
  ]);
});

it("watches thread states only once the phone has the overview, and only reports changes", async () => {
  const { b, events } = bridge();
  b.refresh();
  expect(events).toEqual([]);
  await b.handle("overview", []);
  b.refresh();
  b.refresh();
  expect(events.map((e) => e.kind)).toEqual(["chats"]);
});

it("tells a watching phone about thread lists as they change, a new project's too", async () => {
  const otherId = randomUUID();
  const projects = [{ id: projectId, name: "Relay" }];
  const lists: Record<string, ChatSummary[]> = {
    [projectId]: [
      {
        id: chatId,
        projectId,
        title: "New chat",
        scope: { kind: "project" },
        created: 1,
        updated: 2,
      },
    ],
  };
  const events: RemoteEvent[] = [];
  const b = new RemoteBridge(
    {
      projects: async () => projects,
      chats: (id: string) => lists[id] ?? [],
      name: () => "Studio",
    } as unknown as RemoteHost,
    (e) => events.push(e),
  );
  const titles = () =>
    events.map((e) => (e.kind === "chats" ? e.chats.map((c) => c.title) : []));
  await b.handle("overview", []);
  lists[projectId]![0]!.title = "Cache guard";
  b.chatsChanged(projectId);
  expect(events).toEqual([]);

  b.setWatching(true);
  b.chatsChanged(projectId);
  b.chatsChanged(projectId);
  expect(titles()).toEqual([["Cache guard"]]);

  projects.push({ id: otherId, name: "Site" });
  lists[otherId] = [
    {
      ...lists[projectId]![0]!,
      id: randomUUID(),
      projectId: otherId,
      title: "Hero",
      updated: 3,
    },
  ];
  b.chatsChanged(otherId);
  await vi.waitFor(() =>
    expect(titles()).toEqual([["Cache guard"], ["Hero", "Cache guard"]]),
  );
});

it("asks the desktop for each kind of diff and sends it as lines", async () => {
  const { b, dispatched } = bridge();
  const where = `${projectId}/${chatId}`,
    sha = "a".repeat(40);
  for (const source of [
    { kind: "turn", chatId, messageId: chatId, path: "a.ts" },
    { kind: "working", where, path: "a.ts", area: "staged" },
    { kind: "commit", where, sha, path: "a.ts" },
    { kind: "worktree", chatId, path: "a.ts" },
  ]) {
    const diff = (await b.handle("diff", [source])) as RemoteDiff;
    expect(diff.hunks[0]!.lines.map((l) => l.kind)).toEqual(["del", "add"]);
  }
  expect(dispatched).toEqual([
    { method: "projectTurnDiff", args: [chatId, chatId, "a.ts"] },
    { method: "projectWorkingDiff", args: [where, "a.ts", "staged"] },
    { method: "projectCommitDiff", args: [where, sha, "a.ts"] },
    { method: "projectWorktreeDiff", args: [chatId, "a.ts"] },
  ]);
  await expect(
    b.handle("diff", [{ kind: "working", where, path: "a.ts", area: "all" }]),
  ).rejects.toThrow();
});

it("numbers diff lines and cuts very long diffs short", () => {
  const diff = toRemoteDiff("a.ts", {
    binary: false,
    old: { name: "a.ts", contents: "one\ntwo\nthree\n", cacheKey: "1" },
    next: { name: "a.ts", contents: "one\n2\nthree\nfour\n", cacheKey: "2" },
  });
  expect(diff.hunks[0]!.lines).toEqual([
    { kind: "same", text: "one", old: 1, new: 1 },
    { kind: "del", text: "two", old: 2 },
    { kind: "add", text: "2", new: 2 },
    { kind: "same", text: "three", old: 3, new: 3 },
    { kind: "add", text: "four", new: 4 },
  ]);
  const long = toRemoteDiff("big.txt", {
    binary: false,
    old: null,
    next: {
      name: "big.txt",
      contents: Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n"),
      cacheKey: "3",
    },
  });
  expect(long.truncated).toBe(true);
  expect(long.hunks.flatMap((h) => h.lines)).toHaveLength(3000);
});

it("sends a project's icon only when the phone's copy is missing or stale", async () => {
  const [withIcon, without] = [randomUUID(), randomUUID()];
  const icons: Record<string, string | null> = {
    [withIcon]: "data:image/svg+xml;base64,PHN2Zy8+",
    [without]: null,
  };
  const host = {
    projects: async () => [
      { id: withIcon, name: "App", path: "/a", repository: null, added: 1 },
      { id: without, name: "Lib", path: "/l", repository: null, added: 2 },
    ],
    chats: () => [],
    dispatch: async (method: string, args: unknown[]) =>
      method === "projectIcon" ? icons[args[0] as string] : null,
    name: () => "Studio",
  } as unknown as RemoteHost;
  const b = new RemoteBridge(host, () => {});
  const icon = (known: Record<string, string | null>) =>
    b.handle("projectIcons", [known]) as Promise<
      Record<string, { hash: string | null; dataUrl?: string }>
    >;

  const first = await icon({});
  expect(first[withIcon]).toEqual({
    hash: expect.any(String),
    dataUrl: icons[withIcon],
  });
  expect(first[without]).toEqual({ hash: null });

  const known = { [withIcon]: first[withIcon]!.hash, [without]: null };
  expect(await icon(known)).toEqual({});

  icons[withIcon] = "data:image/png;base64,iVBORw0KGgo=";
  const next = await icon(known);
  expect(Object.keys(next)).toEqual([withIcon]);
  expect(next[withIcon]!.dataUrl).toBe(icons[withIcon]);
  expect(next[withIcon]!.hash).not.toBe(first[withIcon]!.hash);
});

it("sends a thread's latest hundred messages, and older pages on request", async () => {
  const messages = Array.from({ length: 250 }, (_, i) => ({
    id: `m${i}`,
    role: "user" as const,
    body: `message ${i}`,
    status: "complete" as const,
    created: i,
    version: 1,
  }));
  const host = {
    projects: async () => [],
    projectPath: () => "/r",
    chats: () => [],
    chat: async () => ({
      id: chatId,
      projectId,
      title: "Long",
      scope: { kind: "project" },
      created: 1,
      updated: 2,
      messages,
    }),
    dispatch: async () => null,
    name: () => "Studio",
  } as unknown as RemoteHost;
  const b = new RemoteBridge(host, () => {});
  const page = async (history?: number) => {
    const chat = (await b.handle(
      "chat",
      history ? [chatId, undefined, history] : [chatId],
    )) as { messages: { id: string }[]; earlier: number };
    return [chat.messages[0]!.id, chat.messages.length, chat.earlier];
  };
  expect(await page()).toEqual(["m150", 100, 150]);
  expect(await page(200)).toEqual(["m50", 200, 50]);
  expect(await page(300)).toEqual(["m0", 250, 0]);
  await expect(page(5000)).rejects.toThrow();
});

it("sends a phone a long tool output's ends, and the whole of it when asked", async () => {
  const messageId = randomUUID();
  const output = `${"a".repeat(1000)}${"b".repeat(1000)}`;
  const message: ChatMessage = {
    id: messageId,
    role: "assistant",
    body: "Done",
    status: "complete",
    created: 1,
    provider: "claude",
    version: 1,
    trace: [
      { kind: "commentary", id: "c", text: "Looking" },
      {
        kind: "activity",
        id: "t1",
        activity: {
          id: "t1",
          kind: "command",
          label: "npm test",
          status: "complete",
          detail: output,
        },
      },
      {
        kind: "activity",
        id: "t2",
        activity: {
          id: "t2",
          kind: "command",
          label: "ls",
          status: "complete",
          detail: "short",
        },
      },
    ],
  };
  const host = {
    projects: async () => [],
    projectPath: () => "/r",
    chats: () => [],
    chat: async () => ({
      id: chatId,
      projectId,
      title: "Tools",
      scope: { kind: "project" },
      created: 1,
      updated: 2,
      messages: [message],
    }),
    dispatch: async () => null,
    name: () => "Studio",
  } as unknown as RemoteHost;
  const b = new RemoteBridge(host, () => {});
  const chat = (await b.handle("chat", [chatId])) as {
    messages: ChatMessage[];
  };
  const [long, short] = chat.messages[0]!.trace!.flatMap((e) =>
    e.kind === "activity" ? [e.activity] : [],
  );
  expect(long!.detail).toBe(`${"a".repeat(300)}\n…\n${"b".repeat(300)}`);
  expect(long!.detailCut).toBe(1400);
  expect(short).toEqual(
    message.trace![2]!.kind === "activity" && message.trace![2]!.activity,
  );
  expect(await b.handle("activityDetail", [chatId, messageId, "t1"])).toBe(
    output,
  );
  expect(
    await b.handle("activityDetail", [chatId, messageId, "gone"]),
  ).toBeNull();
});

it("lets a phone read a subagent's run with its tool output cut, as a thread's", async () => {
  const run = {
    id: "toolu_a",
    description: "Map the SDK",
    status: "running",
    started: 1,
    calls: 1,
    recent: [],
    trace: [
      {
        kind: "activity",
        id: "t1",
        activity: {
          id: "t1",
          kind: "read",
          label: "Read sdk.d.ts",
          status: "complete",
          detail: "x".repeat(5000),
        },
      },
    ],
  };
  const host = {
    projects: async () => [],
    chats: () => [],
    dispatch: async () => run,
    name: () => "Studio",
  } as unknown as RemoteHost;
  const b = new RemoteBridge(host, () => {});
  const sent = (await b.handle("desktop", [
    "projectChatAgent",
    [chatId, "toolu_a"],
  ])) as typeof run;
  const activity = sent.trace[0]!.activity as Record<string, unknown>;
  expect(activity.detail).toBe(`${"x".repeat(300)}\n…\n${"x".repeat(300)}`);
  // There's no message to fetch the rest from.
  expect(activity).not.toHaveProperty("detailCut");
  expect(run.trace[0]!.activity.detail).toHaveLength(5000);
});

it("tells a phone what a queued message needs to be taken back, but leaves its screenshots on the desktop", async () => {
  const input = (id: string, over = {}) => ({
    id,
    body: "@claude look",
    to: "claude" as const,
    provider: "claude" as const,
    choice: { model: "opus", fast: false, reasoningEffort: "high" },
    runtimeMode: "approval-required" as const,
    interactionMode: "default" as const,
    ...over,
  });
  const shot = { name: "a.png", mimeType: "image/png", dataUrl: "data:x" };
  const host = {
    projects: async () => [],
    projectPath: () => "/r",
    chats: () => [],
    chat: async () => ({
      id: chatId,
      projectId,
      title: "Queued",
      scope: { kind: "project" },
      created: 1,
      updated: 2,
      messages: [],
      queue: [
        { input: input("a", { images: [shot], parentId: "root" }), created: 1 },
      ],
      scheduled: [{ input: input("b"), created: 1, at: 99 }],
    }),
    dispatch: async () => null,
    name: () => "Studio",
  } as unknown as RemoteHost;
  const chat = (await new RemoteBridge(host, () => {}).handle("chat", [
    chatId,
  ])) as {
    queue: Record<string, unknown>[];
    scheduled: Record<string, unknown>[];
  };
  expect(chat.queue).toEqual([
    {
      id: "a",
      body: "@claude look",
      images: 1,
      parentId: "root",
      to: "claude",
      settings: {
        provider: "claude",
        choice: { model: "opus", fast: false, reasoningEffort: "high" },
        runtimeMode: "approval-required",
        interactionMode: "default",
      },
    },
  ]);
  expect(JSON.stringify(chat)).not.toContain("data:x");
  expect(chat.scheduled[0]).toMatchObject({ id: "b", at: 99, to: "claude" });
});

it("lets a phone fetch a queued message's screenshots through the desktop", async () => {
  const { b, dispatched } = bridge();
  await b.handle("desktop", ["projectChatQueuedImages", [chatId, "a"]]);
  expect(dispatched).toEqual([
    { method: "projectChatQueuedImages", args: [chatId, "a"] },
  ]);
});

it("sends a thread's image shrunk to what the phone shows, through the desktop's own calls", async () => {
  const { b, dispatched } = bridge();
  const shrunk: [unknown, number][] = [];
  (b as unknown as { host: RemoteHost }).host.shrinkImage = (url, max) => {
    shrunk.push([url, max]);
    return "small";
  };
  const messageId = randomUUID(),
    imageId = randomUUID();
  expect(
    await b.handle("image", [{ kind: "attached", chatId, imageId }, 264]),
  ).toBe("small");
  await b.handle("image", [
    { kind: "read", chatId, messageId, path: "/r/shot.png" },
    1200,
  ]);
  expect(dispatched).toEqual([
    { method: "projectChatImage", args: [chatId, imageId] },
    {
      method: "projectChatReadImage",
      args: [chatId, messageId, "/r/shot.png"],
    },
  ]);
  expect(shrunk.map(([, max]) => max)).toEqual([264, 1200]);
  await expect(
    b.handle("image", [{ kind: "attached", chatId, imageId }, 1e6]),
  ).rejects.toThrow();
});
