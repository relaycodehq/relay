import { afterEach, expect, it, vi } from "vitest";
import { pollSubagents } from "../../mobile/src/remote/subagent-poll";

afterEach(() => vi.useRealTimers());

it("backs unchanged reads off to 20s, resets on changes and stops when hidden", async () => {
  vi.useFakeTimers();
  const request = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
  const stop = pollSubagents(request, true);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9999);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(request).toHaveBeenCalledTimes(3);
  request.mockResolvedValue(true);
  await vi.advanceTimersByTimeAsync(20_000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledTimes(5);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(5);
});

it("backs failures off to 60s without making concurrent requests", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockRejectedValue(new Error("Link lost"));
  const stop = pollSubagents(request, true);
  await vi.advanceTimersByTimeAsync(10_000 + 20_000 + 40_000);
  expect(request).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(request).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(5);
  stop();
});

it("invalidates an in-flight answer on blur and never schedules its next read", async () => {
  vi.useFakeTimers();
  let finish!: (changed: boolean) => void;
  let current!: () => boolean;
  const request = vi.fn((isCurrent: () => boolean) => {
    current = isCurrent;
    return new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  });
  const stop = pollSubagents(request, true);
  await vi.advanceTimersByTimeAsync(100_000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(current()).toBe(true);
  stop();
  expect(current()).toBe(false);
  finish(true);
  await vi.advanceTimersByTimeAsync(100_000);
  expect(request).toHaveBeenCalledTimes(1);
});

it("reads a finished thread once without an idle polling loop", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(true);
  pollSubagents(request, false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(1);
});
