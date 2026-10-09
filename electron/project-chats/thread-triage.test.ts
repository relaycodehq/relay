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

  await chats.triage(lead.id, {
    kind: "restore",
    from: triageState(await chats.get(lead.id)),
    to: before,
  });
  expect((await chats.get(lead.id)).settledAt).toBeUndefined();
  expect((await chats.get(done.id)).settledAt).toBeUndefined();
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
