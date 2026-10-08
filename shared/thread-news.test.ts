import { describe, expect, it } from "vitest";
import type { RemoteChatSummary } from "./remote";
import {
  preview,
  threadNews,
  threadsRead,
  type LastAnswer,
} from "./thread-news";

const chat = (
  id: string,
  more: Partial<RemoteChatSummary> = {},
): RemoteChatSummary => ({
  id,
  projectId: "p",
  title: `Thread ${id}`,
  scope: "project",
  updated: 10,
  created: 1,
  provider: "claude",
  ...more,
});
const list = (...chats: RemoteChatSummary[]) =>
  new Map(chats.map((c) => [c.id, c]));
const answer = (more: Partial<LastAnswer>): LastAnswer => ({
  status: "complete",
  body: "",
  provider: "claude",
  ...more,
});

describe("threadNews", () => {
  it("tells of a finished answer by its first words, a failed one by its error", () => {
    const before = list(
      chat("a", { running: true }),
      chat("b", { running: true }),
    );
    const news = threadNews(
      before,
      [chat("a", { updated: 20 }), chat("b", { updated: 20 })],
      new Map([
        [
          "a",
          answer({
            body: "## Done\n\nFixed **the** [race](src/x.ts) in `turn-run.ts`.",
          }),
        ],
        ["b", answer({ status: "failed", error: "Claude's login expired." })],
      ]),
    );
    expect(news).toEqual([
      {
        chatId: "a",
        kind: "finished",
        title: "Thread a",
        body: "Done Fixed the race in turn-run.ts.",
      },
      {
        chatId: "b",
        kind: "failed",
        title: "Thread b",
        body: "Claude's login expired.",
      },
    ]);
  });

  it("tells of a question at once, even while the agent still runs", () => {
    const news = threadNews(
      list(chat("a", { running: true })),
      [chat("a", { running: true, waiting: true })],
      new Map(),
    );
    expect(news).toEqual([
      {
        chatId: "a",
        kind: "waiting",
        title: "Thread a",
        body: "Claude needs you",
      },
    ]);
  });

  it("stays quiet about new threads, stopped answers, snoozed ones and ones read where they ran", () => {
    const before = list(
      chat("stopped", { running: true }),
      chat("snoozed", { running: true }),
      chat("watched", { running: true }),
    );
    const news = threadNews(
      before,
      [
        chat("new", { waiting: true }),
        chat("stopped"),
        chat("snoozed", { snoozedUntil: 5_000 }),
        chat("watched", { updated: 20, seenAt: 20 }),
      ],
      new Map([["stopped", answer({ status: "cancelled" })]]),
      1_000,
    );
    expect(news).toEqual([]);
  });

  it("clears a notification once the thread is read somewhere", () => {
    expect(
      threadsRead(list(chat("a", { updated: 20, seenAt: 10 }), chat("b")), [
        chat("a", { updated: 20, seenAt: 20 }),
        chat("b"),
      ]),
    ).toEqual(["a"]);
  });
});

describe("preview", () => {
  it("leaves code blocks out and cuts long answers", () => {
    expect(preview("Run this:\n```sh\nnpm test\n```\nthen look.")).toBe(
      "Run this: then look.",
    );
    expect(preview("word ".repeat(100))).toHaveLength(240);
  });
});
