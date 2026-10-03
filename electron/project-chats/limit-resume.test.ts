import { it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { threadControl } from "./control";
import { LimitResumes } from "./limit-resume";

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
      load: async () => chat,
      persist: vi.fn(async () => {}),
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
