import { describe, expect, it } from "vitest";
import type { RemoteChatSummary } from "./remote";
import {
  answerNews,
  preview,
  threadsRead,
  waitingNews,
  type LastAnswer,
} from "./thread-news";
import type { Turn } from "./turns";

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
  body: "",
  ...more,
});

/** A turn that started at 10. */
const turn = (
  endedAs: Turn["endedAs"],
  kind: Turn["kind"] = "answer",
): Pick<Turn, "kind" | "endedAs" | "startedAt" | "provider"> => ({
  kind,
  endedAs,
  startedAt: 10,
  provider: "claude",
});

describe("answerNews", () => {
  it("keeps quiet about compactions, notes and side answers, and stopped answers", () => {
    for (const kind of ["compaction", "handoff", "aside"] as const)
      expect(
        answerNews(turn("completed", kind), chat("a"), answer({ body: "Hi" })),
      ).toBeUndefined();
    for (const endedAs of [
      "cancelled",
      "unstarted",
      "interrupted",
      "lost",
    ] as const)
      expect(answerNews(turn(endedAs), chat("a"), answer({}))).toBeUndefined();
  });

  it("tells of a finished answer by its first words, a failed one by its error", () => {
    expect(
      answerNews(
        turn("completed"),
        chat("a"),
        answer({
          body: "## Done\n\nFixed **the** [race](src/x.ts) in `turn-run.ts`.",
        }),
      ),
    ).toEqual({
      chatId: "a",
      kind: "finished",
      title: "Thread a",
      body: "Done: Fixed the race in turn-run.ts.",
    });
    expect(
      answerNews(
        turn("failed"),
        chat("b"),
        answer({ error: "Claude's login expired." }),
      ),
    ).toEqual({
      chatId: "b",
      kind: "failed",
      title: "Thread b",
      body: "Claude's login expired.",
    });
    // The provider's words, not the envelope around them.
    expect(
      answerNews(
        turn("failed", "adopt"),
        chat("c"),
        answer({
          error:
            'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
        }),
      ),
    ).toEqual({
      chatId: "c",
      kind: "failed",
      title: "Thread c",
      body: "Overloaded",
    });
  });

  it("names the agent whose turn ended, not the one that answered last", () => {
    const codexLast = chat("a", { provider: "codex" });
    expect(answerNews(turn("completed"), codexLast, answer({}))?.body).toBe(
      "Claude finished",
    );
    expect(answerNews(turn("failed"), codexLast, answer({}))?.body).toBe(
      "Claude's answer failed",
    );
  });

  it("stays quiet about snoozed threads", () => {
    expect(
      answerNews(
        turn("completed"),
        chat("snoozed", { snoozedUntil: 5_000 }),
        answer({}),
        1_000,
      ),
    ).toBeUndefined();
  });

  it("stays quiet when a thread settled while it ran finishes, but tells of one that woke up on its own", () => {
    const news = (
      c: RemoteChatSummary,
      endedAs: Turn["endedAs"] = "completed",
    ) =>
      answerNews(turn(endedAs, "adopt"), c, answer({ error: "Boom." }))?.kind;
    expect(
      news(chat("settling", { settledAt: 15, settleWhenDone: 15 })),
    ).toBeUndefined();
    expect(news(chat("settled", { settledAt: 21 }))).toBeUndefined();
    expect(
      news(chat("failed", { settledAt: 15, settleWhenDone: 15 }), "failed"),
    ).toBe("failed");
    // Settled long ago; Claude started a turn itself since.
    expect(news(chat("woke", { settledAt: 5 }))).toBe("finished");
  });

  it("still reports a failed turn while an earlier async question remains open, but not a finished one", () => {
    const waiting = chat("a", { waiting: true, asking: true });
    expect(
      answerNews(
        turn("failed"),
        waiting,
        answer({
          error: 'API Error: 529 {"error":{"message":"Overloaded"}}',
        }),
      ),
    ).toEqual({
      chatId: "a",
      kind: "failed",
      title: "Thread a",
      body: "Overloaded",
    });
    expect(answerNews(turn("completed"), waiting, answer({}))).toBeUndefined();
  });
});

describe("waitingNews", () => {
  it("tells of a question at once, even while the agent still runs", () => {
    expect(
      waitingNews(
        false,
        chat("a", { running: true, waiting: true, asking: true }),
      ),
    ).toEqual({
      chatId: "a",
      kind: "waiting",
      title: "Thread a",
      body: "Claude needs you",
    });
  });

  it("stays quiet about new threads, ones already waiting and ones read", () => {
    expect(
      waitingNews(undefined, chat("new", { waiting: true })),
    ).toBeUndefined();
    expect(waitingNews(true, chat("a", { waiting: true }))).toBeUndefined();
    expect(
      waitingNews(false, chat("a", { waiting: true, updated: 20, seenAt: 20 })),
    ).toBeUndefined();
  });
});

it("clears a notification once the thread is read somewhere", () => {
  expect(
    threadsRead(list(chat("a", { updated: 20, seenAt: 10 }), chat("b")), [
      chat("a", { updated: 20, seenAt: 20 }),
      chat("b"),
    ]),
  ).toEqual(["a"]);
});

describe("preview", () => {
  it("leaves code blocks out and cuts long answers", () => {
    expect(preview("Run this:\n```sh\nnpm test\n```\nthen look.")).toBe(
      "Run this: then look.",
    );
    expect(preview("word ".repeat(100))).toHaveLength(240);
  });

  it("runs a heading into its text with a colon, and cuts where asked", () => {
    expect(preview("## Proposed plan\n\n1. Add **retries** to `sync`")).toBe(
      "Proposed plan: Add retries to sync",
    );
    expect(preview("# Done?\nYes.")).toBe("Done? Yes.");
    expect(preview("## Summary")).toBe("Summary");
    expect(preview("word ".repeat(100), 80)).toHaveLength(80);
  });
});
