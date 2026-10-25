import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Store } from "../app/store";
import type { ChatStorage } from "./storage";
import { WatchReviews } from "./watch-review";
vi.mock("../agents", () => ({ agentRuntime: vi.fn() }));

vi.mock("../agents/helper-output", async (original) => ({
  ...(await original<typeof import("../agents/helper-output")>()),
  emptyCwd: vi.fn(),
  unfence: (s: string) => s,
}));

vi.mock("../agents/helper-fallback", () => ({ runHelperJob: vi.fn() }));
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-watch-review-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function reviews(path: string) {
  const now = Date.now();
  const summaries = ["a", "b"].map((id) => ({ id, title: id, updated: now }));
  const store = { get: () => ({ chats: summaries }) } as unknown as Store;
  const storage = {
    peek: async (id: string) => ({
      id,
      messages: [
        {
          id: "m",
          role: "assistant",
          body: "answer",
          status: "complete",
          notes: [
            {
              id,
              tag: "Heads up",
              title: id,
              line: id,
              points: [],
              created: now - 7 * 60 * 60_000,
            },
          ],
        },
      ],
    }),
  } as unknown as ChatStorage;
  return new WatchReviews(store, storage, path);
}

function answer(service: WatchReviews) {
  return vi
    .spyOn(
      service as unknown as { ask(prompt: string): Promise<string> },
      "ask",
    )
    .mockResolvedValue(
      '[{"note":"N1","worth":"yes","later":"never","why":"Useful"}]',
    );
}

it("serializes concurrent thread verdicts after a torn tail and reloads their index", async () => {
  const path = join(dir, "review");
  await writeFile(path, '{"noteId":');
  const service = reviews(path);
  const ask = answer(service);
  expect(
    (await service.judge(7)).notes.every((n) => n.verdict?.worth === "yes"),
  ).toBe(true);
  expect(ask).toHaveBeenCalledTimes(2);
  const restarted = reviews(path);
  const nextAsk = answer(restarted);
  expect((await restarted.judge(7)).notes.every((n) => !!n.verdict)).toBe(true);
  expect(nextAsk).not.toHaveBeenCalled();
});

it("does not mark failed verdicts as saved and retries them on the next pass", async () => {
  const path = join(dir, "review");
  await writeFile(path, "");
  const service = reviews(path);
  const ask = answer(service);
  await service.review(7);
  await rm(path);
  await mkdir(path);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(
    (await service.judge(7)).notes.every((n) => n.ready && !n.verdict),
  ).toBe(true);
  await rm(path, { recursive: true });
  expect((await service.judge(7)).notes.every((n) => !!n.verdict)).toBe(true);
  expect(ask).toHaveBeenCalledTimes(4);
  expect((await reviews(path).review(7)).notes.every((n) => !!n.verdict)).toBe(
    true,
  );
});
