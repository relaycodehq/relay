import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage, ProjectChat, ProjectChatSend } from "../../shared/projects";
import type { Schedule, ScheduleInput } from "../../shared/schedules";
import type { Store } from "../app/store";
import { Schedules } from ".";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const project = randomUUID();

function input(patch: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    name: "Weekly changelog",
    projectId: project,
    prompt: "Draft the changelog.",
    repeat: "weekly",
    days: [4],
    time: "09:00",
    freshChat: true,
    workspace: "worktree",
    agent: "claude",
    choice: { model: "", fast: false, reasoningEffort: "" },
    runtimeMode: "auto-accept-edits",
    tokenLimit: 0,
    enabled: true,
    ...patch,
  };
}

/** Schedules over threads kept in memory; `answer` ends a run's turn. */
function setup({ busy = false } = {}) {
  let state: { schedules?: Schedule[] } = {};
  const store = {
    get: () => state,
    update: async (change: (s: typeof state) => void) => {
      const next = structuredClone(state);
      change(next);
      state = next;
    },
  } as unknown as Store;
  const threads = new Map<string, ProjectChat>();
  let saved: ((chat: ProjectChat) => void) | undefined;
  const chats = {
    create: vi.fn(async (projectId: string) => {
      const id = `chat-${threads.size + 1}`;
      threads.set(id, { id, projectId, messages: [] } as unknown as ProjectChat);
      return { id, projectId };
    }),
    send: vi.fn(async (id: string, sent: ProjectChatSend) => {
      threads.get(id)!.messages.push({
        id: sent.id,
        role: "user",
        body: sent.body,
        status: "complete",
      } as ChatMessage);
    }),
    get: async (id: string) => structuredClone(threads.get(id)!),
    busy: vi.fn(async () => busy),
    cancel: vi.fn(async () => {}),
    onSaved: (listener: (chat: ProjectChat) => void) => {
      saved = listener;
      return () => {};
    },
  };
  const schedules = new Schedules(store, {
    chats,
    projects: { has: () => true, name: () => "Acme Web", scratch: async () => ({ id: "scratch" }) },
    changed: () => {},
  });
  /** The run's answer in `chatId` as it stands now; saved as its turn ends unless it's still going. */
  const answer = (chatId: string, message: Partial<ChatMessage>) => {
    const chat = threads.get(chatId)!;
    chat.messages = chat.messages.filter((m) => m.role !== "assistant" || m.id !== "answer");
    chat.messages.push({ id: "answer", role: "assistant", body: "", status: "complete", ...message } as ChatMessage);
    if (message.status !== "streaming") saved?.(chat);
  };
  const runs = () => schedules.list()[0].runs;
  return { schedules, chats, answer, runs };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Thursday 29 Oct 2026, 10:00.
  vi.setSystemTime(new Date(2026, 9, 29, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

it("starts a thread at its time and records what the answer said", async () => {
  const { schedules, chats, answer, runs } = setup();
  const saved = await schedules.save(null, input());
  await vi.advanceTimersByTimeAsync(23 * 60 * MINUTE);
  expect(chats.create).toHaveBeenCalledWith(project, { kind: "project" }, "worktree");
  expect(chats.send.mock.calls[0][1]).toMatchObject({
    body: "Draft the changelog.",
    scheduled: { id: saved.id, name: "Weekly changelog" },
  });
  expect(runs()[0]).toMatchObject({ outcome: "running", chatId: "chat-1" });

  answer("chat-1", {
    body: "## Drafted notes for 14 changes\n\nTwo are breaking.",
    context: { usedTokens: 20_000, totalTokens: 38_400 },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(runs()[0]).toMatchObject({
    outcome: "done",
    summary: "Drafted notes for 14 changes",
    tokens: 38_400,
  });
});

it("skips a run while the last one is still going", async () => {
  const { schedules, chats, runs } = setup({ busy: true });
  await schedules.save(null, input());
  await vi.advanceTimersByTimeAsync(23 * 60 * MINUTE);
  await vi.advanceTimersByTimeAsync(7 * DAY);
  expect(chats.create).toHaveBeenCalledTimes(1);
  expect(runs()[0]).toMatchObject({
    outcome: "skipped",
    summary: "The last run was still going",
  });
});

it("catches up the one run a night asleep missed, but skips days of them", async () => {
  const { schedules, chats, runs } = setup();
  await schedules.save(null, input({ repeat: "daily", time: "02:00" }));
  // Timers stand still while the computer sleeps; the clock moves on.
  vi.setSystemTime(Date.now() + DAY);
  schedules.armAll();
  await vi.advanceTimersByTimeAsync(0);
  expect(chats.create).toHaveBeenCalledTimes(1);

  vi.setSystemTime(Date.now() + 3 * DAY);
  schedules.armAll();
  await vi.advanceTimersByTimeAsync(0);
  expect(chats.create).toHaveBeenCalledTimes(1);
  expect(runs()[0]).toMatchObject({
    outcome: "skipped",
    summary: "Didn't run 3 times while Relay was closed",
  });
});

it("stops a run that uses more than its token limit", async () => {
  const { schedules, chats, answer, runs } = setup();
  await schedules.save(null, input({ tokenLimit: 50_000 }));
  await vi.advanceTimersByTimeAsync(23 * 60 * MINUTE);
  answer("chat-1", { status: "streaming", context: { usedTokens: 61_000 } });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(chats.cancel).toHaveBeenCalledWith("chat-1");

  answer("chat-1", { status: "cancelled", context: { usedTokens: 61_000 } });
  await vi.advanceTimersByTimeAsync(0);
  expect(runs()[0]).toMatchObject({
    outcome: "stopped",
    summary: "Stopped at its token limit",
  });
});

it("gives a test run its own thread when the runs share one", async () => {
  const { schedules, chats, answer } = setup();
  const saved = await schedules.save(null, input({ freshChat: false }));
  await vi.advanceTimersByTimeAsync(23 * 60 * MINUTE);
  answer("chat-1", { body: "Done." });
  await vi.advanceTimersByTimeAsync(0);

  expect(await schedules.test(saved.id)).toBe("chat-2");
  await vi.advanceTimersByTimeAsync(7 * DAY);
  expect(chats.create).toHaveBeenCalledTimes(2);
  expect(chats.send.mock.calls.at(-1)![0]).toBe("chat-1");
});

it("won't turn on a schedule that has nothing to send", async () => {
  const { schedules } = setup();
  await expect(schedules.save(null, input({ prompt: "  " }))).rejects.toThrow(
    "Write what it should do before turning it on.",
  );
});
