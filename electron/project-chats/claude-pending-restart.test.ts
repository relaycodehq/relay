import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { claudePending } from "../agents/claude/project";
import type { ChatPending } from "../../shared/projects";
import { defaultAISettings } from "../../shared/settings";

vi.mock("../agents/claude/project", async (actual) => ({
  ...(await actual<typeof import("../agents/claude/project")>()),
  claudePending: vi.fn(() => []),
  closeClaudeSession: vi.fn(),
}));

let root: string, store: Store, projects: Projects, chats: ProjectChats;
let projectId: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-pending-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  store = new Store(join(root, "state"));
  await store.load();
  projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
});
afterEach(async () => {
  vi.useRealTimers();
  vi.mocked(claudePending).mockReset().mockReturnValue([]);
  await chats.dispose();
  await rm(root, { recursive: true, force: true });
});

/** A live Claude session for the thread, with this work outstanding. */
function leave(chatId: string, items: ChatPending[], branch = "main") {
  const key = JSON.stringify([join(root, "chats"), chatId, branch]);
  (chats as unknown as { sessions: { add(key: string): void } }).sessions.add(
    key,
  );
  vi.mocked(claudePending).mockImplementation((k) => (k === key ? items : []));
}

const task: ChatPending = {
  kind: "task",
  id: "ab",
  description: "Run A/B",
  since: 1,
};
const loop: ChatPending = {
  kind: "wakeup",
  id: "loop",
  prompt: "Check CI",
  recurring: true,
};

it("keeps what Claude was waiting on when Relay closes", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const at = Date.now() + 60_000;
  leave(chat.id, [
    task,
    loop,
    { kind: "wakeup", id: "later", prompt: "Compare", recurring: false, at },
  ]);
  expect(chats.runningTasks()).toEqual([task]);
  await chats.dispose();
  vi.mocked(claudePending).mockReturnValue([]);
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const [summary] = chats.list(projectId);
  expect(summary.stopped?.items).toEqual([task, loop]);
  // Relay sends the one-shot wake-up itself; it shows as still pending.
  expect(summary.pending).toEqual([
    { kind: "wakeup", id: "later", prompt: "Compare", recurring: false, at },
  ]);
  await chats.resolveStoppedWork(chat.id, "dismiss");
  expect(chats.list(projectId)[0].stopped).toBeUndefined();
  // Cancelling a held wake-up just forgets it.
  await chats.stopPending(chat.id, "later");
  expect(chats.list(projectId)[0].pending).toBeUndefined();
});

it("picks stopped work back up in the side conversation that ran it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const reply = randomUUID();
  leave(chat.id, [task], reply);
  await chats.dispose();
  vi.mocked(claudePending).mockReturnValue([]);
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const send = vi.spyOn(chats, "send").mockResolvedValue(undefined);
  await chats.resolveStoppedWork(chat.id, "resume");
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][1]).toMatchObject({
    parentId: reply,
    body: expect.stringContaining("Run A/B"),
  });
});

it("sends a kept wake-up itself once it comes due", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  leave(chat.id, [
    {
      kind: "wakeup",
      id: "due",
      prompt: "Compare the runs",
      recurring: false,
      at: Date.now() - 1000,
    },
  ]);
  await chats.dispose();
  vi.mocked(claudePending).mockReturnValue([]);
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const send = vi.spyOn(chats, "send").mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  chats.armWakeups();
  // Missed while closed: it goes out shortly after launch, not at once.
  await vi.advanceTimersByTimeAsync(14_000);
  expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  vi.useRealTimers();
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][1]).toMatchObject({
    provider: "claude",
    body: expect.stringContaining("Compare the runs"),
  });
  expect(chats.list(projectId)[0].heldWakeups).toBeUndefined();
});

it("holds a kept wake-up weeks away past the longest timer", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  leave(chat.id, [
    {
      kind: "wakeup",
      id: "far",
      prompt: "Renew the certificate",
      recurring: false,
      at: Date.now() + 30 * 86_400_000,
    },
  ]);
  await chats.dispose();
  vi.mocked(claudePending).mockReturnValue([]);
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const send = vi.spyOn(chats, "send").mockResolvedValue(undefined);
  await chats.get(chat.id);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  chats.armWakeups();
  // A timer fires after at most 2^31 - 1 ms, about 24.8 days. Sending drops
  // the held copy first, before anything waits on the disk.
  await vi.advanceTimersByTimeAsync(29 * 86_400_000);
  expect((await chats.get(chat.id)).heldWakeups).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(86_400_000);
  vi.useRealTimers();
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
});

it("won't archive a thread with work still to run in it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const later = {
    id: randomUUID(),
    body: "Check the deploy.",
    provider: "claude" as const,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    choice: defaultAISettings.questions,
    sendAt: Date.now() + 3_600_000,
  };
  await chats.send(chat.id, later);
  const archive = () => chats.triage(chat.id, { kind: "archive" });
  await expect(archive()).rejects.toThrow("before archiving");
  await chats.queueAction(chat.id, "remove", later.id);
  leave(chat.id, [task]);
  await expect(archive()).rejects.toThrow("before archiving");
  vi.mocked(claudePending).mockReturnValue([]);
  await expect(archive()).resolves.toMatchObject({
    archivedAt: expect.any(Number),
  });
});

it("rolls back copied wake-ups and stopped work when an ordinary quit is cancelled", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  leave(chat.id, [
    task,
    loop,
    {
      kind: "wakeup",
      id: "later",
      prompt: "Compare",
      recurring: false,
      at: Date.now() + 60_000,
    },
  ]);
  const saved = await (
    chats as unknown as {
      storage: {
        load(id: string): Promise<import("../../shared/projects").ProjectChat>;
      };
    }
  ).storage.load(chat.id);
  saved.heldWakeups = [
    { id: "existing", prompt: "Earlier", at: Date.now() + 120_000 },
  ];
  const original = structuredClone(saved.heldWakeups);
  await chats.prepareToQuit();
  expect(saved.heldWakeups).toHaveLength(2);
  await chats.resumeAfterCancelledQuit();
  expect(saved.heldWakeups).toEqual(original);
  expect(saved.stopped).toBeUndefined();
  expect(
    chats.list(projectId)[0].pending?.filter((p) => p.id === "later"),
  ).toHaveLength(1);
  const internals = chats as unknown as {
    schedule: { timers: Map<string, unknown> };
  };
  expect(
    [...internals.schedule.timers.keys()].filter((k) => k.includes("later")),
  ).toHaveLength(0);
  await chats.prepareToQuit();
  expect(saved.heldWakeups).toHaveLength(2);
  await chats.resumeAfterCancelledQuit();
  expect(saved.heldWakeups).toEqual(original);
});

it("rolls back pending copies when saving fails during quit preparation", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  leave(chat.id, [
    {
      kind: "wakeup",
      id: "later",
      prompt: "Compare",
      recurring: false,
      at: Date.now() + 60_000,
    },
  ]);
  const fail = vi
    .spyOn(store, "flush")
    .mockRejectedValueOnce(Error("disk full"));
  await expect(chats.prepareToQuit()).rejects.toThrow("disk full");
  expect((await chats.get(chat.id)).heldWakeups).toBeUndefined();
  expect(chats.list(projectId)[0].pending).toHaveLength(1);
  fail.mockRestore();
});
