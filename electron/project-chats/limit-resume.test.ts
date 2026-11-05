import { it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { threadControl } from "./control";
import { LimitResumes } from "./limit-resume";
import { AgentError } from "../agents/errors";
import { usageResetsAt } from "../agents/usage-limit";

vi.mock("../agents/usage-limit", () => ({ usageResetsAt: vi.fn() }));

const MINUTE = 60_000;
let chat: ProjectChat;

/** A thread whose answer a limit stopped, lifting `lifts` from now. */
function stopped(lifts: number): ProjectChat {
  const question = { id: "q", role: "user", status: "complete" };
  const answer = { id: "a", role: "assistant", status: "failed" };
  return {
    id: "chat",
    messages: [question, answer],
    lastInput: { id: "q" },
    queue: [{ input: { id: "next" } }],
    queuePaused: true,
    limitResume: { messageId: "a", provider: "claude", at: Date.now() + lifts },
  } as unknown as ProjectChat;
}

function planner(resume = vi.fn(async () => {})) {
  const core = {
    store: { get: () => ({ chats: [chat] }) },
    storage: {
      has: () => true,
      load: async () => chat,
      save: vi.fn(async () => {}),
    },
    control: threadControl(),
    closing: () => false,
  } as unknown as ChatCore;
  return { limits: new LimitResumes(core, { resume }), resume };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("fires a plan that fell due while the computer slept once it is armed again", async () => {
  chat = stopped(60 * MINUTE);
  const { limits, resume } = planner();
  limits.armAll();
  // Timers stand still while the Mac sleeps, but the clock moves on.
  vi.setSystemTime(Date.now() + 2 * 60 * MINUTE);
  await vi.advanceTimersByTimeAsync(5 * MINUTE);
  expect(resume).not.toHaveBeenCalled();
  limits.armAll();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(resume).toHaveBeenCalledWith("chat");
});

it("resumes nothing when a message landed in the thread before its resume got its turn", async () => {
  chat = stopped(-MINUTE);
  const { limits, resume } = planner();
  const core = (limits as unknown as { core: ChatCore }).core;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const held = core.control("chat", () => gate);
  // Queued behind whatever holds the thread, ahead of the resume.
  const sent = core.control("chat", async () => {
    chat.messages.push({ id: "s", role: "user" } as never);
    delete chat.limitResume;
  });
  const fired = (limits as unknown as { fire(id: string): Promise<void> }).fire(
    "chat",
  );
  open();
  await Promise.all([held, sent, fired]);
  expect(resume).not.toHaveBeenCalled();
  expect(chat.queuePaused).toBe(true);
});

it("puts the pause back on the queue when carrying on fails to start", async () => {
  chat = stopped(-MINUTE);
  const { limits } = planner(
    vi.fn(async () => {
      throw new Error("Relay is closing.");
    }),
  );
  await expect(
    (limits as unknown as { fire(id: string): Promise<void> }).fire("chat"),
  ).rejects.toThrow("Relay is closing.");
  expect(chat.queuePaused).toBe(true);
  expect(chat.limitResume).toBeUndefined();
});

/** The thread's answer was just stopped by a limit the agent said lifted a minute ago. */
async function stoppedOnStaleReset(usageSays: number) {
  vi.setSystemTime(new Date("2026-11-05T14:00:00+01:00"));
  chat = stopped(0);
  delete chat.limitResume;
  vi.mocked(usageResetsAt).mockReset().mockResolvedValue(usageSays);
  const { limits } = planner();
  const past = Date.now() - MINUTE;
  await limits.stopped(
    "chat",
    "a",
    new AgentError("claude", "usageLimit", "limit", past),
  );
  return limits;
}

it("reads usage for the reset when the agent's own reset has already passed", async () => {
  const lifts = new Date("2026-11-05T16:00:00+01:00").getTime();
  await stoppedOnStaleReset(lifts);
  expect(chat.limitResume?.at).toBe(lifts);
});

it("reads usage once and plans nothing when it also reports a passed reset", async () => {
  await stoppedOnStaleReset(new Date("2026-11-05T13:00:00+01:00").getTime());
  await vi.advanceTimersByTimeAsync(10 * 60 * MINUTE);
  expect(chat.limitResume).toBeUndefined();
  expect(usageResetsAt).toHaveBeenCalledTimes(1);
});
