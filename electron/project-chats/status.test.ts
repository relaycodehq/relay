import { expect, it, vi } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  chats,
  projects,
  root,
  projectId,
  input,
  useProjectChats,
  waitForChatEvent,
  waitForSummary,
} from "../../tests/fixtures/project-chats-harness";
import { AgentWorkspaces } from "./agent-workspaces";
import { ThreadList } from "./thread-list";

vi.mock("../platform/executables");

useProjectChats();

async function completedThread() {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Check the status"));
  await waitForChatEvent(
    chat.id,
    ({ message }) => message.status === "complete",
  );
  await waitForSummary(chat.id, (summary) => !summary.running);
  return chat;
}

it("reads progress without cloning the history or refreshing worktrees, and keeps snapshots independent", async () => {
  const chat = await completedThread();
  const full = await chats.get(chat.id);
  const last = full.messages
    .filter((m) => m.role === "assistant" && !m.parentId)
    .at(-1)!;
  const refresh = vi.spyOn(AgentWorkspaces.prototype, "refresh");
  const clone = vi.spyOn(globalThis, "structuredClone");
  const first = await chats.status(chat.id);
  expect(first).toMatchObject({
    summary: { id: chat.id },
    status: "done",
    latest: last.body,
  });
  expect(first).not.toHaveProperty("messages");
  expect(
    clone.mock.calls.some(
      ([value]) => value && typeof value === "object" && "messages" in value,
    ),
  ).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
  first.summary.title = "Changed outside the service";
  first.summary.scope.kind = "review";
  const second = await chats.status(chat.id);
  expect(second.summary.title).toBe(full.title);
  expect(second.summary.scope.kind).toBe("project");
});

it("includes live approval requests and keeps a stopped queue paused", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture request approval"));
  await waitForSummary(chat.id, (summary) => !!summary.blocked);
  const [request] = (await chats.get(chat.id)).requests!;
  expect(await chats.status(chat.id)).toMatchObject({
    status: "needs-input",
    asks: [request.title],
  });
  await chats.send(chat.id, input("@codex Queued for later"));
  await chats.cancel(chat.id);
  await waitForSummary(chat.id, (summary) => !summary.running);
  const stopped = await chats.get(chat.id);
  expect(stopped.queue).toHaveLength(1);
  expect(stopped.queuePaused).toBe(true);
  expect(await chats.status(chat.id)).toMatchObject({ status: "stopped" });
  expect((await chats.status(chat.id)).asks).toBeUndefined();
});

it("reports async questions while work continues, then needs input once the turn ends", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture async question live"));
  await waitForSummary(
    chat.id,
    (summary) => !!summary.asking && !!summary.running,
  );
  expect(await chats.status(chat.id)).toMatchObject({
    status: "working",
    asks: ["Which visibility should I use?", "Which account should own it?"],
  });
  await chats.cancel(chat.id);
  await waitForSummary(chat.id, (summary) => !summary.running);
  expect(await chats.status(chat.id)).toMatchObject({ status: "needs-input" });
});

it("uses the other computer's live requests and queue instead of saved state here", async () => {
  const chat = await completedThread();
  await chats.handoffs.mark(chat.id, {
    id: "handoff",
    computerId: "other",
    computer: "Other computer",
    at: Date.now(),
    home: true,
    live: true,
  });
  await chats.handoffs.updateSentTo(chat.id, "handoff", { state: "away" });
  const queue = [{ input: input("Continue there"), created: Date.now() }];
  chats.liveHandoff.setLive(chat.id, { queue });
  expect(await chats.status(chat.id)).toMatchObject({ status: "working" });
  chats.liveHandoff.setLive(chat.id, { queue, queuePaused: true });
  expect(await chats.status(chat.id)).toMatchObject({ status: "done" });
  chats.liveHandoff.setLive(chat.id, {
    running: true,
    waiting: true,
    blocked: true,
    requests: [
      {
        id: "approval",
        kind: "approval",
        title: "Run checks there?",
        detail: "npm test",
      },
    ],
  });
  const status = await chats.status(chat.id);
  expect(status).toMatchObject({
    status: "needs-input",
    asks: ["Run checks there?"],
  });
  expect(status.folder).toBeUndefined();
  chats.liveHandoff.setLive(chat.id, {});
  expect((await chats.status(chat.id)).asks).toBeUndefined();
});

it("does not expose missing or archived threads through status reads", async () => {
  await expect(chats.status("missing")).rejects.toThrow("Chat not found");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.triage(chat.id, { kind: "archive" });
  await expect(chats.status(chat.id)).rejects.toThrow("Chat not found");
});

it("builds each project's live list once for explicit and started-thread batches", async () => {
  const lead = await chats.create(projectId, { kind: "project" });
  const startedBy = { chatId: lead.id, agent: "codex" as const };
  const a = await chats.create(
    projectId,
    { kind: "project" },
    "checkout",
    startedBy,
  );
  const b = await chats.create(
    projectId,
    { kind: "project" },
    "checkout",
    startedBy,
  );
  const folder = join(root, "other-project");
  await mkdir(folder);
  const other = await projects.add(folder, null, { exact: true });
  const c = await chats.create(
    other.id,
    { kind: "project" },
    "checkout",
    startedBy,
  );
  const archived = await chats.create(
    projectId,
    { kind: "project" },
    "checkout",
    startedBy,
  );
  await chats.triage(archived.id, { kind: "archive" });
  const expected = chats
    .startedThreads(lead.id)
    .filter((s) => !s.archivedAt)
    .map((s) => s.id);
  const lists = vi.spyOn(ThreadList.prototype, "list");
  const refresh = vi.spyOn(AgentWorkspaces.prototype, "refresh");
  const clone = vi.spyOn(globalThis, "structuredClone");
  try {
    const batch = await chats.statuses({ ids: [c.id, b.id, a.id, b.id] });
    expect(batch.map((s) => s.summary.id)).toEqual([c.id, b.id, a.id, b.id]);
    expect(lists.mock.calls).toEqual([[projectId], [other.id]]);
    lists.mockClear();
    expect(
      (await chats.statuses({ startedBy: lead.id })).map((s) => s.summary.id),
    ).toEqual(expected);
    expect(lists.mock.calls).toEqual([[projectId], [other.id]]);
    expect(refresh).not.toHaveBeenCalled();
    expect(
      clone.mock.calls.some(
        ([value]) => value && typeof value === "object" && "messages" in value,
      ),
    ).toBe(false);
    await expect(chats.statuses({ ids: [a.id, "missing"] })).rejects.toThrow(
      "Chat not found",
    );
    await expect(chats.statuses({ ids: [a.id, archived.id] })).rejects.toThrow(
      "Chat not found",
    );
  } finally {
    lists.mockRestore();
    refresh.mockRestore();
    clone.mockRestore();
  }
});
