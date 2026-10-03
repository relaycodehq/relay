import { it, expect, vi } from "vitest";
import type { ChatSummary } from "../../shared/projects";
import { PullMerges, type PullHost } from "./pull-merges";

const NOW = 1_000_000;
const repo = { owner: "acme", name: "app" };

/** A worktree thread with an open PR that nobody has looked at. */
function thread(id: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    projectId: "p1",
    updated: NOW - 5000,
    worktree: { path: `/w/${id}`, pr: { number: Number(id), url: "u" } },
    ...extra,
  } as ChatSummary;
}

function setup(chats: ChatSummary[], host: Partial<PullHost> = {}) {
  const recorded: string[] = [];
  const mergedAmong = vi.fn(async (_repo, numbers: number[]) =>
    numbers.filter((n) => n === 1),
  );
  const merged = vi.fn(async (_repo, number: number) => number === 1);
  const service = new PullMerges({
    chats: () => chats,
    repository: async () => repo,
    mergedAmong,
    merged,
    record: async (id) => void recorded.push(id),
    online: () => true,
    now: () => NOW,
    ...host,
  });
  return { service, recorded, mergedAmong, merged };
}

it("marks a thread nobody opened as merged once its PR merged", async () => {
  const { service, recorded, mergedAmong } = setup([thread("1"), thread("2")]);
  await service.sweep();
  expect(recorded).toEqual(["1"]);
  // One request for the repository's threads, not one per thread.
  expect(mergedAmong).toHaveBeenCalledTimes(1);
  expect(mergedAmong.mock.calls[0]![1]).toEqual([1, 2]);
});

it("leaves out threads with nothing to find", async () => {
  const { service, mergedAmong } = setup([
    thread("1", { archivedAt: NOW - 1 }),
    thread("2", { settledAt: NOW, updated: NOW - 1 }),
    thread("3", { worktree: undefined }),
    thread("4", { worktree: { pr: { number: 4, url: "u" } } }),
    thread("5", {
      worktree: { pr: { number: 5, url: "u" }, landed: { at: 1, by: "pr" } },
    }),
    thread("6", { reviewer: { parent: "x" } } as Partial<ChatSummary>),
  ]);
  await service.sweep();
  expect(mergedAmong).toHaveBeenCalledTimes(1);
  expect(mergedAmong.mock.calls[0]![1]).toEqual([4]);
});

it("makes no request when offline, signed out, or nothing has a PR", async () => {
  const off = setup([thread("1")], { online: () => false });
  await off.service.sweep();
  expect(off.mergedAmong).not.toHaveBeenCalled();

  const out = setup([thread("1")], { repository: async () => null });
  await out.service.sweep();
  expect(out.mergedAmong).not.toHaveBeenCalled();
  expect(out.recorded).toEqual([]);

  const none = setup([thread("1", { worktree: undefined })]);
  await none.service.sweep();
  expect(none.mergedAmong).not.toHaveBeenCalled();
});

it("batches by repository and survives one repository failing", async () => {
  const chats = [thread("1"), thread("2", { projectId: "p2" })];
  const asked: string[] = [];
  const { service, recorded } = setup(chats, {
    repository: async (id) => ({ owner: "acme", name: id }),
    mergedAmong: async (r, numbers) => {
      asked.push(r.name);
      if (r.name === "p1") throw new Error("down");
      return numbers;
    },
  });
  await service.sweep();
  expect(asked).toEqual(["p1", "p2"]);
  expect(recorded).toEqual(["2"]);
});

it("does not start a sweep while the last one is still asking", async () => {
  let release!: () => void;
  const held = new Promise<number[]>((resolve) => {
    release = () => resolve([]);
  });
  const mergedAmong = vi.fn(() => held);
  const { service } = setup([thread("1")], { mergedAmong });
  const first = service.sweep();
  await service.sweep();
  expect(mergedAmong).toHaveBeenCalledTimes(1);
  release();
  await first;
});

it("stops asking after the timeout instead of hanging the sweep", async () => {
  vi.useFakeTimers();
  try {
    const { service, recorded } = setup([thread("1")], {
      mergedAmong: (_repo, _numbers, signal) =>
        new Promise<number[]>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("timeout"))),
        ),
    });
    const sweep = service.sweep();
    await vi.advanceTimersByTimeAsync(60_000);
    await sweep;
    expect(recorded).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("answers an open thread's question from the same host, at most once a minute", async () => {
  let now = NOW;
  const { service, recorded, merged } = setup([thread("1"), thread("2")], {
    now: () => now,
  });
  expect(await service.check("2", 2)).toBe(false);
  expect(await service.check("2", 2)).toBe(false);
  expect(merged).toHaveBeenCalledTimes(1);
  expect(await service.check("1", 1)).toBe(true);
  expect(recorded).toEqual(["1"]);
  now += 61_000;
  await service.check("2", 2);
  expect(merged).toHaveBeenCalledTimes(3);
});
