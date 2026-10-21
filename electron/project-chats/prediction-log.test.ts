import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PredictionLog } from "./prediction-log";

const cost = (usd?: number) => ({
  model: "test",
  tokens: { input: 1, cacheWrite: 0, cacheRead: 9000, output: 12 },
  ...(usd === undefined ? {} : { usd }),
});
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-predictions-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it("weighs the week's guesses against what was sent and what the threads spent", async () => {
  const path = join(dir, "predictions.jsonl");
  const old = Date.now() - 9 * 24 * 60 * 60_000;
  await writeFile(
    path,
    JSON.stringify({
      kind: "asked",
      offered: true,
      cost: cost(5),
      at: old,
      chatId: "a",
    }) + "\n",
  );
  const log = new PredictionLog(path);
  log.asked("a", { offered: true, cost: cost(0.02) });
  log.asked("a", { offered: false, cost: cost(0.01) });
  log.asked("b", { offered: true });
  log.sent("a", "go with B", "@claude go with B ");
  log.sent("b", "run the e2e too", "no, revert it");
  const threadUsd = vi.fn(async () => 1.5);
  const summary = await log.summary(7, threadUsd);
  expect(summary).toMatchObject({
    asked: 3,
    offered: 2,
    sentAfter: 2,
    taken: 1,
    unmeasured: 1,
    threadUsd: 1.5,
  });
  expect(summary.usd).toBeCloseTo(0.03);
  expect(threadUsd).toHaveBeenLastCalledWith(
    new Set(["a", "b"]),
    expect.any(Number),
  );
});

it("backs off after 20 guesses nobody sent, until one is", async () => {
  const path = join(dir, "predictions.jsonl");
  const lines = [{ kind: "sent", taken: true, at: Date.now(), chatId: "a" }];
  for (let i = 0; i < 20; i++)
    lines.push({ kind: "sent", taken: false, at: Date.now(), chatId: "a" });
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const log = new PredictionLog(path);
  expect((await log.summary(7, async () => 0)).backingOff).toBe(true);
  const turns = Array.from({ length: 20 }, () => log.allows());
  expect(turns.filter(Boolean)).toHaveLength(2);
  log.sent("a", "go with B", "go with B");
  expect(log.allows()).toBe(true);
  expect((await log.summary(7, async () => 0)).backingOff).toBe(false);
});

it("keeps backing off from the first turn after a start, counting sends made meanwhile", async () => {
  const path = join(dir, "predictions.jsonl");
  const lines = Array.from({ length: 19 }, () => ({
    kind: "sent",
    taken: false,
    at: Date.now(),
    chatId: "a",
  }));
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const log = new PredictionLog(path);
  const first = log.allows();
  log.sent("a", "go with B", "no, revert it");
  await expect(first).resolves.toBe(true);
  expect((await log.summary(7, async () => 0)).backingOff).toBe(true);
  expect(log.allows()).toBe(false);
});
