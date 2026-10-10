import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { undoTriage } from "../../shared/remote-triage";
import { chatActivitySection } from "../../shared/chat-activity";
import { triageState } from "../../shared/chat-activity";
import type { ChatCore } from "./core";
import type { ThreadWorktrees } from "./worktrees";
import type { Councils } from "./councils";
import { ThreadTriage } from "./thread-triage";
import { StartedThreads } from "../started-threads";
import { resultText } from "../relay-mcp";

let root: string, store: Store, chats: ProjectChats, projectId: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-triage-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  store = new Store(join(root, "state"));
  await store.load();
  const projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
});
afterEach(async () => {
  await chats?.dispose();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

const scope = { kind: "project" } as const;

it("settling a thread settles the threads it started that are done, and undo brings them back", async () => {
  const lead = await chats.create(projectId, scope);
  const startedBy = { chatId: lead.id, agent: "claude" as const };
  const done = await chats.create(projectId, scope, "checkout", startedBy);
  const scheduled = await chats.create(projectId, scope, "checkout", startedBy);
  const stranger = await chats.create(projectId, scope);
  const asking = await chats.create(projectId, scope, "checkout", startedBy);
  // Seed a saved child without starting a real agent.
  const storage = (chats as unknown as { core: import("./core").ChatCore }).core
    .storage;
  const child = await storage.load(asking.id);
  child.messages.push({
    id: "question",
    role: "assistant",
    provider: "codex",
    status: "complete",
    body: "Which?",
    created: 1,
    version: 1,
    questions: [{ id: "ask", questions: [{ id: "q", question: "Which?" }] }],
  });
  await storage.save(child);
  // A message sent later means it isn't done yet.
  await chats.send(scheduled.id, {
    id: randomUUID(),
    body: "Later",
    sendAt: Date.now() + 3_600_000,
    provider: "claude",
    to: "claude",
    choice: { model: "", fast: false, reasoningEffort: "" },
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  const before = triageState(await chats.get(lead.id));

  await chats.triage(lead.id, { kind: "settle" });
  const settledAt = (await chats.get(lead.id)).settledAt;
  expect(settledAt).toBeDefined();
  expect((await chats.get(done.id)).settledAt).toBe(settledAt);
  expect((await chats.get(scheduled.id)).settledAt).toBeUndefined();
  expect((await chats.get(stranger.id)).settledAt).toBeUndefined();
  expect((await chats.get(asking.id)).settledAt).toBeUndefined();

  await chats.triage(lead.id, {
    kind: "restore",
    from: triageState(await chats.get(lead.id)),
    to: before,
  });
  expect((await chats.get(lead.id)).settledAt).toBeUndefined();
  expect((await chats.get(done.id)).settledAt).toBeUndefined();
});

it("snoozing or unsettling a thread leaves the threads it started as they were", async () => {
  const lead = await chats.create(projectId, scope);
  const startedBy = { chatId: lead.id, agent: "claude" as const };
  const done = await chats.create(projectId, scope, "checkout", startedBy);
  await chats.triage(lead.id, { kind: "snooze", until: Date.now() + 3_600_000 });
  expect((await chats.get(done.id)).settledAt).toBeUndefined();
  await chats.triage(lead.id, { kind: "unsettle" });
  expect((await chats.get(done.id)).settledAt).toBeUndefined();
});

/** A thread with a turn running, and the way to end it as `status`. */
async function runningThread() {
  const thread = await chats.create(projectId, scope);
  const core = (chats as unknown as { core: ChatCore }).core;
  const triaging = (chats as unknown as { triaging: ThreadTriage }).triaging;
  const active = core.active.claim(thread.id, {
    id: randomUUID(),
    body: "Commit",
    provider: "claude",
    to: "claude",
    choice: { model: "", fast: false, reasoningEffort: "" },
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  const end = async (status: "complete" | "failed" | "cancelled") => {
    const chat = await core.storage.load(thread.id);
    chat.messages.push({
      id: randomUUID(),
      role: "assistant",
      provider: "claude",
      status,
      body: "Done",
      created: Date.now(),
      version: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    chat.updated = Date.now();
    await core.storage.save(chat);
    core.active.release(thread.id, active);
    await triaging.ended(thread.id);
  };
  const listed = () => chats.list(projectId).find((c) => c.id === thread.id)!;
  return { id: thread.id, end, listed };
}

it("settles a running thread when its answer finishes, and it stays settled", async () => {
  const thread = await runningThread();
  await chats.triage(thread.id, { kind: "settle-when-done" });
  expect(chatActivitySection(thread.listed(), Date.now())).toBe("settled");

  await thread.end("complete");
  const after = thread.listed();
  expect(after.settleWhenDone).toBeUndefined();
  expect(after.settledAt).toBeGreaterThanOrEqual(after.updated);
  expect(chatActivitySection(after, Date.now())).toBe("settled");
});

it("brings a thread settled while running back when its answer fails", async () => {
  const thread = await runningThread();
  await chats.triage(thread.id, { kind: "settle-when-done" });
  await thread.end("failed");
  const after = thread.listed();
  expect(after.settleWhenDone).toBeUndefined();
  expect(chatActivitySection(after, Date.now())).toBe("active");
});

it("unsettling a thread settled while running lets its answer come back as usual", async () => {
  const thread = await runningThread();
  await chats.triage(thread.id, { kind: "settle-when-done" });
  await chats.triage(thread.id, { kind: "unsettle" });
  await thread.end("complete");
  expect(chatActivitySection(thread.listed(), Date.now())).toBe("active");
});

/** Relay quits with `id` settled while it runs, after `left` saves what the quit left; then starts again. */
async function quitAndRestart(
  id: string,
  left: (chat: import("../../shared/projects").ProjectChat) => void,
) {
  const core = (chats as unknown as { core: ChatCore }).core;
  const chat = await core.storage.load(id);
  left(chat);
  await core.storage.save(chat);
  await chats.dispose();
  chats = new ProjectChats(
    store,
    new Projects(store),
    join(root, "chats"),
    () => {},
  );
  const listed = () => chats.list(projectId).find((c) => c.id === id)!;
  // Nothing has looked at it since the quit.
  expect(chatActivitySection(listed(), Date.now())).toBe("settled");
  await (chats as unknown as { triaging: ThreadTriage }).triaging.restarted();
  return listed();
}

it("brings a thread settled while running back when quitting Relay cut its answer off", async () => {
  const thread = await runningThread();
  await chats.triage(thread.id, { kind: "settle-when-done" });
  const after = await quitAndRestart(thread.id, (chat) =>
    chat.messages.push({
      id: randomUUID(),
      role: "assistant",
      provider: "claude",
      status: "streaming",
      body: "Committing",
      created: Date.now(),
      version: 1,
    }),
  );
  expect(after.settleWhenDone).toBeUndefined();
  expect(chatActivitySection(after, Date.now())).toBe("active");
});

it("brings a thread settled while running back when quitting Relay stopped its background work", async () => {
  const thread = await runningThread();
  await chats.triage(thread.id, { kind: "settle-when-done" });
  const after = await quitAndRestart(thread.id, (chat) => {
    chat.messages.push({
      id: randomUUID(),
      role: "assistant",
      provider: "claude",
      status: "complete",
      body: "Started the build in the background",
      created: Date.now(),
      version: 1,
    });
    chat.stopped = { at: Date.now(), items: [] };
  });
  expect(after.settleWhenDone).toBeUndefined();
  expect(chatActivitySection(after, Date.now())).toBe("active");
});

it("a started thread settled on its own stays settled when its lead's settle is undone", async () => {
  const lead = await chats.create(projectId, scope);
  const child = await chats.create(projectId, scope, "checkout", {
    chatId: lead.id,
    agent: "codex",
  });
  await chats.triage(child.id, { kind: "settle" });
  const own = (await chats.get(child.id)).settledAt;
  await new Promise((r) => setTimeout(r, 5));
  const before = triageState(await chats.get(lead.id));
  await chats.triage(lead.id, { kind: "settle" });
  await chats.triage(lead.id, {
    kind: "restore",
    from: triageState(await chats.get(lead.id)),
    to: before,
  });
  expect((await chats.get(child.id)).settledAt).toBe(own);
});

it("a detached thread stands alone: settling its old lead leaves it be", async () => {
  const lead = await chats.create(projectId, scope);
  const startedBy = { chatId: lead.id, agent: "claude" as const };
  const child = await chats.create(projectId, scope, "checkout", startedBy);

  const detached = await chats.detach(child.id);
  expect(detached.startedBy).toBeUndefined();

  await chats.triage(lead.id, { kind: "settle" });
  expect((await chats.get(child.id)).settledAt).toBeUndefined();
});

it("leave to drive threads stays with the thread until taken back, and a fork starts without it", async () => {
  const lead = await chats.create(projectId, scope);
  const storage = (chats as unknown as { core: import("./core").ChatCore }).core
    .storage;
  const chat = await storage.load(lead.id);
  chat.messages.push(
    {
      id: "ask",
      role: "user",
      provider: "claude",
      status: "complete",
      body: "Go",
      created: 1,
      version: 1,
    },
    {
      id: "answer",
      role: "assistant",
      provider: "claude",
      status: "complete",
      body: "Done.",
      created: 2,
      version: 1,
    },
  );
  await storage.save(chat);

  expect((await chats.allowDriving(lead.id, true)).drivesThreads).toBe(true);
  expect(chats.list(projectId).find((c) => c.id === lead.id)).toMatchObject({
    drivesThreads: true,
  });
  const fork = await chats.fork(lead.id);
  expect((await chats.get(fork.id)).drivesThreads).toBeUndefined();

  expect(
    (await chats.allowDriving(lead.id, false)).drivesThreads,
  ).toBeUndefined();
  expect((await chats.get(lead.id)).drivesThreads).toBeUndefined();
});

it("a lead sees a started thread that settled by itself as settled", async () => {
  const lead = await chats.create(projectId, scope);
  const startedBy = { chatId: lead.id, agent: "claude" as const };
  const child = await chats.create(projectId, scope, "checkout", startedBy);
  const quiet = Date.now() - 30 * 86_400_000;
  await store.update((s) => {
    s.chats!.find((c) => c.id === child.id)!.updated = quiet;
  });
  expect(chats.startedThreads(lead.id)).toEqual([
    expect.objectContaining({ id: child.id, settledAt: quiet }),
  ]);
  const tools = new StartedThreads(chats);
  const settle = await tools.handle(
    lead.id,
    "settle_thread",
    { id: child.id },
    new AbortController().signal,
  );
  expect(resultText(settle)).toBe("Already settled.");
  expect((await chats.get(child.id)).settledAt).toBeUndefined();
});

it("promotes links atomically and does not resurrect the old thread link after reload", async () => {
  const links = [{ path: join(root, "backend"), access: "write" as const }];
  const made = await chats.create(
    projectId,
    scope,
    "checkout",
    undefined,
    undefined,
    links,
  );
  await store.update((s) => {
    s.projects!.find((p) => p.id === projectId)!.settings = {
      worktreeSetup: "npm ci",
    };
  });
  const promoted = await chats.promoteLink(made.id, links[0].path);
  expect(promoted.project.settings).toEqual({ worktreeSetup: "npm ci", links });
  expect(promoted.chat.links).toBeUndefined();
  expect(
    store.get().chats!.find((c) => c.id === made.id)!.links,
  ).toBeUndefined();
  await chats.dispose();
  chats = new ProjectChats(
    store,
    new Projects(store),
    join(root, "chats"),
    () => {},
  );
  expect((await chats.get(made.id)).links).toBeUndefined();
  await chats.rename(made.id, "Renamed");
  expect(
    store.get().chats!.find((c) => c.id === made.id)!.links,
  ).toBeUndefined();
});

it("leaves both link scopes unchanged when the promotion transaction fails", async () => {
  const links = [{ path: join(root, "backend"), access: "write" as const }];
  const made = await chats.create(
    projectId,
    scope,
    "checkout",
    undefined,
    undefined,
    links,
  );
  const before = structuredClone(store.get());
  const failed = vi
    .spyOn(store, "update")
    .mockRejectedValueOnce(new Error("disk refused"));
  await expect(chats.promoteLink(made.id, links[0].path)).rejects.toThrow(
    "disk refused",
  );
  expect(store.get()).toEqual(before);
  expect((await chats.get(made.id)).links).toEqual(links);
  failed.mockRestore();
  expect(
    (await chats.promoteLink(made.id, links[0].path)).chat.links,
  ).toBeUndefined();
});

it("persists thread link edits in state and keeps them through later chat writes and reloads", async () => {
  const made = await chats.create(projectId, scope);
  const links = [{ path: join(root, "backend"), access: "read" as const }];
  await chats.setLinks(made.id, links);
  await chats.rename(made.id, "Linked thread");
  await chats.dispose();
  chats = new ProjectChats(
    store,
    new Projects(store),
    join(root, "chats"),
    () => {},
  );
  expect((await chats.get(made.id)).links).toEqual(links);
  await chats.setLinks(made.id, []);
  await chats.dispose();
  chats = new ProjectChats(
    store,
    new Projects(store),
    join(root, "chats"),
    () => {},
  );
  expect((await chats.get(made.id)).links).toBeUndefined();
});

it("phone Undo restores the snooze under both a lead and its started thread", async () => {
  const lead = await chats.create(projectId, scope);
  const child = await chats.create(projectId, scope, "checkout", {
    chatId: lead.id,
    agent: "codex",
  });
  const until = Date.now() + 3_600_000;
  await chats.triage(lead.id, { kind: "snooze", until });
  await chats.triage(child.id, { kind: "snooze", until });
  const before = await chats.get(lead.id);
  const after = await chats.triage(lead.id, { kind: "settle" });
  expect(
    chatActivitySection(
      chats.list(projectId).find((c) => c.id === child.id)!,
      Date.now(),
    ),
  ).toBe("settled");
  await chats.triage(lead.id, undoTriage(before, after));
  expect((await chats.get(lead.id)).snoozedUntil).toBe(until);
  expect((await chats.get(child.id)).snoozedUntil).toBe(until);
  expect((await chats.get(child.id)).settledAt).toBeUndefined();
});

it("rejects a stale phone Undo after another triage action", async () => {
  const chat = await chats.create(projectId, scope);
  const before = await chats.get(chat.id);
  const after = await chats.triage(chat.id, { kind: "settle" });
  const until = Date.now() + 3_600_000;
  await chats.triage(chat.id, { kind: "snooze", until });
  await expect(
    chats.triage(chat.id, undoTriage(before, after)),
  ).rejects.toThrow("changed since");
  expect((await chats.get(chat.id)).snoozedUntil).toBe(until);
});

it("keeps a manual unread mark until the thread is opened again at the same update", async () => {
  const chat = await chats.create(projectId, scope);
  await chats.markSeen(chat.id, chat.updated);
  await chats.triage(chat.id, { kind: "unread" });
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.markedUnread,
  ).toBe(true);
  await chats.markSeen(chat.id, chat.updated);
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.markedUnread,
  ).toBeUndefined();
});

it("rejects settle and waiting snooze against live state without changing saved marks", async () => {
  const chat = await chats.create(projectId, scope);
  const save = vi.fn();
  let working = true,
    waiting = false;
  const triage = new ThreadTriage(
    {
      storage: { load: async () => chat, save },
      active: { has: () => working, requests: () => (waiting ? [{}] : []) },
    } as unknown as ChatCore,
    {} as ThreadWorktrees,
    { busy: () => false } as unknown as Councils,
  );
  await expect(triage.triage(chat.id, { kind: "settle" })).rejects.toThrow(
    "running answer",
  );
  working = false;
  chat.waiting = true;
  await expect(triage.triage(chat.id, { kind: "settle" })).rejects.toThrow(
    "running answer",
  );
  delete chat.waiting;
  waiting = true;
  await expect(
    triage.triage(chat.id, { kind: "snooze", until: Date.now() + 3_600_000 }),
  ).rejects.toThrow("waiting request");
  expect(save).not.toHaveBeenCalled();
  expect(chat.settledAt).toBeUndefined();
  expect(chat.snoozedAt).toBeUndefined();
});
