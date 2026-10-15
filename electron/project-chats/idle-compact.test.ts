import { it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatSummary, ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { threadControl } from "./control";
import { IdleCompactions } from "./idle-compact";

const MINUTE = 60_000;
let chat: ProjectChat;

/** A Codex thread whose 130k-token answer last touched the cache `age` ago. */
function answered(age: number, more: Partial<ProjectChat> = {}): ProjectChat {
  const question = { id: "q", role: "user", status: "complete" };
  const answer = {
    id: "a",
    role: "assistant",
    status: "complete",
    provider: "codex",
    context: {
      usedTokens: 130_000,
      cache: { at: Date.now() - age, ttlMs: 60 * MINUTE },
    },
  };
  return {
    id: "chat",
    projectId: "p",
    updated: Date.now() - age,
    messages: [question, answer],
    sessions: { codex: { thread: "t" } },
    ...more,
  } as unknown as ProjectChat;
}

function planner() {
  const compact = vi.fn(async () => {});
  const core = {
    store: { get: () => ({ chats: [chat] }) },
    storage: { load: async () => chat },
    active: { has: () => false },
    control: threadControl(),
    closing: () => false,
  } as unknown as ChatCore;
  const idle = new IdleCompactions(core, {
    summary: (c) => c as unknown as ChatSummary,
    busy: () => false,
    compact,
  });
  return { idle, compact };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("compacts an unread thread five minutes before its cache expires", async () => {
  chat = answered(30 * MINUTE);
  const { idle, compact } = planner();
  await idle.arm("chat");
  await vi.advanceTimersByTimeAsync(24 * MINUTE);
  expect(compact).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1 * MINUTE);
  expect(compact).toHaveBeenCalledWith("chat");
});

it("leaves a read thread to go cold unless it is pinned or snoozed", async () => {
  const read = { seenAt: Date.now() };
  for (const [more, compacts] of [
    [read, false],
    [{ ...read, pinnedAt: 1 }, true],
    [{ ...read, snoozedUntil: Date.now() + 3 * 60 * MINUTE }, true],
    [{ settledAt: Date.now() }, false],
  ] as const) {
    chat = answered(56 * MINUTE, more);
    const { idle, compact } = planner();
    await idle.arm("chat");
    await vi.advanceTimersByTimeAsync(0);
    expect(compact.mock.calls.length > 0, JSON.stringify(more)).toBe(compacts);
  }
});

it("plans nothing after a compaction, or once the Mac slept past the cache", async () => {
  chat = answered(56 * MINUTE);
  chat.messages.push({
    id: "c",
    role: "assistant",
    status: "complete",
    provider: "codex",
    compaction: true,
    context: {
      usedTokens: 130_000,
      cache: { at: Date.now(), ttlMs: 60 * MINUTE },
    },
  } as ProjectChat["messages"][number]);
  const { idle, compact } = planner();
  await idle.arm("chat");
  await vi.advanceTimersByTimeAsync(60 * MINUTE);
  expect(compact).not.toHaveBeenCalled();

  chat = answered(30 * MINUTE);
  await idle.arm("chat");
  // Timers stand still while the Mac sleeps, but the clock moves on.
  vi.setSystemTime(Date.now() + 2 * 60 * MINUTE);
  await vi.advanceTimersByTimeAsync(25 * MINUTE);
  expect(compact).not.toHaveBeenCalled();
});

it("waits out a usage limit instead of compacting into it", async () => {
  chat = answered(56 * MINUTE, {
    limitResume: { messageId: "a", provider: "codex", at: Date.now() + 1 },
  } as Partial<ProjectChat>);
  const { idle, compact } = planner();
  await idle.arm("chat");
  await vi.advanceTimersByTimeAsync(0);
  expect(compact).not.toHaveBeenCalled();
});

it("keeps one plan when arms overlap, and none once stopped", async () => {
  chat = answered(56 * MINUTE);
  const { idle, compact } = planner();
  // Only arm()'s loads wait; the compaction's own load goes straight through.
  const loads: (() => void)[] = [];
  const core = (idle as unknown as { core: ChatCore }).core;
  const gated = () => {
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => (release = resolve));
    loads.push(release);
    core.storage.load = async () => {
      core.storage.load = async () => chat;
      await loaded;
      return chat;
    };
  };
  gated();
  const first = idle.arm("chat");
  gated();
  const second = idle.arm("chat");
  // The older load finishes last.
  loads[1]!();
  loads[0]!();
  await Promise.all([first, second]);
  await vi.advanceTimersByTimeAsync(0);
  expect(compact).toHaveBeenCalledTimes(1);

  compact.mockClear();
  gated();
  const late = idle.arm("chat");
  idle.stop();
  loads.at(-1)!();
  await late;
  await vi.advanceTimersByTimeAsync(60 * MINUTE);
  expect(compact).not.toHaveBeenCalled();
});

it("plans again for what's left when its timer fires early", async () => {
  chat = answered(30 * MINUTE);
  const { idle, compact } = planner();
  await idle.arm("chat");
  // The clock steps back ten minutes while the timer waits.
  vi.setSystemTime(Date.now() - 10 * MINUTE);
  await vi.advanceTimersByTimeAsync(25 * MINUTE);
  expect(compact).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10 * MINUTE);
  expect(compact).toHaveBeenCalledWith("chat");
});
