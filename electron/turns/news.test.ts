import { afterEach, expect, it, vi } from "vitest";
import type { ChatSummary, ProjectChat } from "../../shared/projects";
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
let waiting = false;
let news: TurnNews | undefined;
afterEach(() => {
  news?.dispose();
  queued = false;
  waiting = false;
  vi.restoreAllMocks();
});
/** The thread's file as it was just saved. */
const saved = { id: "t1" } as ProjectChat;
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
    thread: () => chat(waiting ? { waiting } : {}),
    waiting: () => waiting,
  });
  const told: NewsItem[] = [];
  news.onNews((item) => told.push(item));
  /** Runs an answer turn to its end; `ends` leaves it open for later. */
  const answer = (id: string) => {
    const turn = ledger.start({
      threadId: "t1",
      kind: "answer",
      provider: "codex",
    });
    ledger.phase(turn.id, "running", id);
    return (endedAs: "completed" | "cancelled" | "lost") =>
      ledger.end(turn.id, endedAs);
  };
  return { news, told, answer, ledger };
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

it("tells of a held answer once its queue is cleared or paused with nothing run after it", () => {
  const { news, told, answer } = setup();
  queued = true;
  answer("a1")("completed");
  // Still queued: the next message is on its way out.
  news.saved(saved);
  expect(told).toEqual([]);
  queued = false;
  news.saved(saved);
  news.saved(saved);
  expect(told.map((i) => i.body)).toEqual(["Answer a1"]);
});

it("tells once that a thread needs you as its agent asks, and again only after it stopped waiting", () => {
  const { told, ledger } = setup();
  const turn = ledger.start({
    threadId: "t1",
    kind: "answer",
    provider: "codex",
  });
  waiting = true;
  ledger.blocked(turn.id, true);
  news!.saved(saved);
  expect(told.map((i) => [i.kind, i.body])).toEqual([
    ["waiting", "Codex needs you"],
  ]);
  waiting = false;
  ledger.blocked(turn.id, false);
  waiting = true;
  ledger.blocked(turn.id, true);
  expect(told.map((i) => i.kind)).toEqual(["waiting", "waiting"]);
});

it("isn't news of a thread that already waited when it was first seen", () => {
  const { told } = setup();
  waiting = true;
  news!.saved(saved);
  news!.saved(saved);
  expect(told).toEqual([]);
});

it("tells of the finished answer when the turn beside it ends without news of its own", () => {
  const { told, answer } = setup();
  const rider = answer("r1");
  answer("a1")("completed");
  expect(told).toEqual([]);
  rider("lost");
  expect(told.map((i) => i.body)).toEqual(["Answer a1"]);
});

it("keeps quiet when you stopped the turn that ran on", () => {
  const { told, answer } = setup();
  const rider = answer("r1");
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
