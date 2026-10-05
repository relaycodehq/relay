import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { triageState } from "../../shared/chat-activity";

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
