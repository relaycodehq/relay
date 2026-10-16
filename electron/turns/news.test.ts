import { afterEach, expect, it, vi } from "vitest";
import type { ChatSummary } from "../../shared/projects";
import type { NewsItem } from "../../shared/thread-news";
import { MemoryTurnStore } from "./store";
import { TurnLedger } from "./ledger";
import { TurnNews } from "./news";

const chat = (more: Partial<ChatSummary> = {}) =>
  ({
    id: "t1",
    projectId: "p1",
    title: "Thread",
    provider: "codex",
    updated: 1,
    created: 1,
    ...more,
  }) as ChatSummary;

let queued = false;
let news: TurnNews | undefined;
afterEach(() => {
  news?.dispose();
  queued = false;
  vi.restoreAllMocks();
});
function setup() {
  const ledger = new TurnLedger(new MemoryTurnStore());
  news = new TurnNews(ledger, {
    summary: () => chat(),
    answer: (_, answerId) => ({
      id: answerId,
      role: "assistant",
      body: `Answer ${answerId}`,
      status: "complete",
      provider: "codex",
      created: 1,
      version: 1,
    }),
    queued: () => queued,
    list: () => [chat()],
  });
  const told: NewsItem[] = [];
  news.onNews((item) => told.push(item));
  /** Runs an answer turn to its end; `ends` leaves it open for later. */
  const answer = (id: string, rides = false) => {
    const turn = ledger.start({
      threadId: "t1",
      kind: "answer",
      provider: "codex",
      rides,
    });
    ledger.phase(turn.id, "running", id);
    return (endedAs: "completed" | "cancelled" | "lost") =>
      ledger.end(turn.id, endedAs);
  };
  return { news, told, answer };
}

it("tells of answers that ran one after another out of the queue once, at the last", () => {
  const { told, answer } = setup();
  queued = true;
  answer("a1")("completed");
  expect(told).toEqual([]);
  queued = false;
  answer("a2")("completed");
  expect(told.map((i) => [i.kind, i.body])).toEqual([
    ["finished", "Answer a2"],
  ]);
});

it("tells of the finished answer when the turn beside it ends without news of its own", () => {
  const { told, answer } = setup();
  const rider = answer("r1", true);
  answer("a1")("completed");
  expect(told).toEqual([]);
  rider("lost");
  expect(told.map((i) => i.body)).toEqual(["Answer a1"]);
});

it("keeps quiet when you stopped the turn that ran on", () => {
  const { told, answer } = setup();
  const rider = answer("r1", true);
  answer("a1")("completed");
  rider("cancelled");
  expect(told).toEqual([]);
});

it("catches a client up from its cursor, and starts one too far behind afresh", () => {
  const { news, answer } = setup();
  const start = news.since();
  expect(start.items).toBeUndefined();
  answer("a1")("completed");
  answer("a2")("completed");
  expect(news.since(start).items?.map((i) => i.body)).toEqual([
    "Answer a1",
    "Answer a2",
  ]);
  const now = news.since();
  expect(news.since(now).items).toEqual([]);
  // From before a restart, or from further on than this Relay got.
  expect(news.since({ ...now, epoch: "earlier" }).items).toBeUndefined();
  expect(news.since({ ...now, seq: now.seq + 1 }).items).toBeUndefined();
  for (let i = 0; i < 501; i++) answer(`b${i}`)("completed");
  expect(news.since(now).items).toBeUndefined();
});

it("goes on telling the others when one listener fails", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { news, told, answer } = setup();
  const later: NewsItem[] = [];
  news.onNews(() => {
    throw new Error("The window is gone.");
  });
  news.onNews((item) => later.push(item));
  answer("a1")("completed");
  expect([told.length, later.length]).toEqual([1, 1]);
});
