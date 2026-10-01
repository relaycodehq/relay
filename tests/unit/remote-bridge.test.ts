import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  RemoteBridge,
  toRemoteDiff,
  type RemoteHost,
} from "../../electron/remote/bridge";
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
