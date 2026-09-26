import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  RemoteBridge,
  toRemoteDiff,
  type RemoteHost,
} from "../../electron/remote/bridge";
import type { ChatMessage, ProjectChatSend } from "../../shared/projects";
import type { RemoteEvent } from "../../shared/remote";
import { defaultAISettings } from "../../shared/settings";

afterEach(() => vi.useRealTimers());

const chatId = randomUUID(),
  projectId = randomUUID();

function bridge() {
  const events: RemoteEvent[] = [];
  const sent: ProjectChatSend[] = [];
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
    create: async () => ({
      id: chatId,
      projectId,
      title: "New chat",
      scope: { kind: "project" as const },
      created: 1,
      updated: 1,
    }),
    send: async (_id: string, input: ProjectChatSend) => {
      sent.push(input);
    },
    aiSettings: () => ({
      ...defaultAISettings,
      questions: {
        model: "gpt-5.5",
        fast: true,
        reasoningEffort: "low" as const,
      },
    }),
    name: () => "Studio",
  } as unknown as RemoteHost;
  return { b: new RemoteBridge(host, (e) => events.push(e)), events, sent };
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

it("starts a thread from the phone on the default model for its agent", async () => {
  const { b, sent } = bridge();
  const id = randomUUID();
  await b.handle("startChat", [
    projectId,
    { id, body: "Plan the release", provider: "codex", runtimeMode: "auto" },
  ]);
  expect(sent).toEqual([
    {
      id,
      body: "@codex Plan the release",
      provider: "codex",
      choice: { model: "gpt-5.5", fast: true, reasoningEffort: "low" },
      runtimeMode: "auto",
      interactionMode: "default",
    },
  ]);
  await expect(
    b.handle("startChat", [
      projectId,
      { id, body: "x", provider: "codex", runtimeMode: "auto", extra: 1 },
    ]),
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
