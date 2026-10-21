import {
  root,
  chats,
  projectId,
  events,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";
import { agentRuntime } from "../agents";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultAISettings } from "../../shared/settings";
import type { ProjectChat } from "../../shared/projects";

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

useProjectChats();

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});
const settled = (id: string, count: number) =>
  vi.waitFor(async () => {
    const { messages } = await chats.get(id);
    expect(messages).toHaveLength(count);
    expect(messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
    // The turn releases before its final summary is published.
    expect(chats.list(projectId).find((chat) => chat.id === id)?.updated).toBe(
      messages.at(-1)?.ended,
    );
  });
/** The thread's own app-server calls; a title's helper job runs elsewhere. */
const threadCalls = async () =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter((line) => !/^\{"cwd":"[^"]*relay-helper-/.test(line))
    .map((line) => JSON.parse(line))
    .filter((call) => call.thread);

it("restarts Codex on the same thread and notes it quietly", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await settled(chat.id, 2);
  const before = chats.list(projectId)[0];

  await chats.reloadSessions(chat.id);
  const note = (await chats.get(chat.id)).messages.at(-1)!;
  expect(note).toMatchObject({
    role: "assistant",
    provider: "codex",
    status: "complete",
    body: "",
    reload: {},
  });
  // It shows while the agent restarts, then says it's done.
  expect(
    events.filter((e) => e.message.id === note.id).map((e) => e.message.status),
  ).toEqual(["streaming", "complete"]);
  // Your own action: the thread neither moves up nor turns unread.
  const after = chats.list(projectId)[0];
  expect(after.updated).toBe(before.updated);
  expect(after.contextAgent).toBe("codex");

  await chats.send(chat.id, input("@codex And why?"));
  await settled(chat.id, 5);
  const calls = await threadCalls();
  expect(calls.map((call) => call.method)).toEqual([
    "thread/start",
    "thread/resume",
  ]);
  expect(calls[1].thread.threadId).toBe("fixture-thread");
});

it("refuses while an answer runs and reports OpenCode’s shared reload scope", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await expect(chats.reloadSessions(chat.id)).rejects.toThrow(
    "no agent session",
  );
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await settled(chat.id, 2);

  const internals = chats as unknown as {
    active: { claim(id: string, input: object): object };
    storage: {
      load(id: string): Promise<ProjectChat>;
      save(chat: ProjectChat): Promise<void>;
    };
  };
  internals.active.claim(chat.id, input("@codex More"));
  await expect(chats.reloadSessions(chat.id)).rejects.toThrow(
    "Wait for the current answer",
  );

  const other = await chats.create(projectId, { kind: "project" });
  const saved = await internals.storage.load(other.id);
  saved.messages.push({
    id: randomUUID(),
    role: "assistant",
    body: "Done.",
    status: "complete",
    provider: "opencode",
    created: Date.now(),
    version: 1,
  });
  await internals.storage.save(saved);
  const reload = vi
    .spyOn(agentRuntime("opencode"), "reloadSession")
    .mockResolvedValue({ scope: "service" });
  try {
    await chats.reloadSessions(other.id);
    expect(reload).toHaveBeenCalledTimes(1);
    expect((await chats.get(other.id)).messages.at(-1)?.reload).toEqual({
      scope: "service",
    });
  } finally {
    reload.mockRestore();
  }
});
