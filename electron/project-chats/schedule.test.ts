import { it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjectChat } from "../../shared/projects";
import type { ChatCore } from "./core";
import { threadControl } from "./control";
import { ChatSchedule } from "./schedule";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("sends a message held for later that fell due while the computer slept once it is armed again", async () => {
  const hour = 3_600_000;
  const chat = {
    id: "chat",
    messages: [],
    scheduled: [{ input: { id: "m", body: "Check" }, at: Date.now() + hour }],
    nextSend: Date.now() + hour,
  } as unknown as ProjectChat;
  const core = {
    store: { get: () => ({ chats: [chat] }) },
    storage: { load: async () => chat, persist: async () => {} },
    control: threadControl(),
    closing: () => false,
  } as unknown as ChatCore;
  const send = vi.fn(async () => {});
  const schedule = new ChatSchedule(core, { send });
  schedule.armAll();
  vi.setSystemTime(Date.now() + 2 * hour);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(send).not.toHaveBeenCalled();
  schedule.armAll();
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledWith("chat", { id: "m", body: "Check" });
});
