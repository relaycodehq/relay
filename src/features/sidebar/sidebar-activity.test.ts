import { describe, expect, it } from "vitest";
import { attention, draftsFirst, nextAfterSettle, triaged } from "./activity";
import { chatActivitySection } from "../../../shared/chat-activity";
import type { ChatSummary } from "../../../shared/projects";

const chat = (patch: Partial<ChatSummary> = {}): ChatSummary => ({
  id: "c",
  projectId: "p",
  title: "Thread",
  scope: { kind: "project" },
  created: 1_000,
  updated: 5_000,
  ...patch,
});

describe("triaged", () => {
  it("moves a thread to the shelf the desktop will put it on", () => {
    const snoozed = chat({ snoozedAt: 5_000, snoozedUntil: 90_000 });
    const settled = triaged(snoozed, { kind: "settle" }, 6_000);
    expect(chatActivitySection(settled, 7_000)).toBe("settled");
    expect(settled.snoozedUntil).toBeUndefined();

    const auto = chat({ settledAt: 6_000, autoSettled: true });
    const resnoozed = triaged(auto, { kind: "snooze", until: 90_000 }, 7_000);
    expect(chatActivitySection(resnoozed, 8_000)).toBe("snoozed");
    expect(resnoozed.autoSettled).toBeUndefined();

    expect(
      chatActivitySection(triaged(snoozed, { kind: "wake" }, 6_000), 7_000),
    ).toBe("active");
    expect(
      chatActivitySection(triaged(settled, { kind: "unsettle" }, 8_000), 9_000),
    ).toBe("active");
  });

  it("leaves where it is triaged for archiving, unread and auto-settle", () => {
    const settled = chat({ settledAt: 6_000 });
    expect(triaged(settled, { kind: "archive" }, 7_000)).toEqual({
      ...settled,
      archivedAt: 7_000,
    });
    expect(triaged(settled, { kind: "unread" }, 7_000).settledAt).toBe(6_000);
    expect(
      triaged(settled, { kind: "auto-settle", enabled: false }, 7_000)
        .autoSettleOff,
    ).toBe(true);
  });
});

describe("nextAfterSettle", () => {
  const active = ["a", "b", "c"].map((id) => chat({ id }));
  it("opens the one below, or above when it was last", () => {
    expect(nextAfterSettle(active, "b")?.id).toBe("c");
    expect(nextAfterSettle(active, "c")?.id).toBe("b");
  });
  it("opens the first when the settled one wasn't listed, and none when it was alone", () => {
    expect(nextAfterSettle(active, "x")?.id).toBe("a");
    expect(nextAfterSettle([chat({ id: "a" })], "a")).toBeUndefined();
  });
});

describe("attention", () => {
  it("counts questions and news, marking questions first", () => {
    const news = chat({ id: "n" });
    const question = chat({ id: "q", waiting: true });
    const unread = (c: ChatSummary) => c.id === "n";
    expect(attention([news, question], unread)).toEqual({
      count: 2,
      mark: "waiting",
    });
    expect(attention([news], unread)).toEqual({ count: 1, mark: "unread" });
    expect(attention([chat()], unread)).toEqual({
      count: 0,
      mark: undefined,
    });
  });
});

describe("draftsFirst", () => {
  it("puts threads with unsent text first, off the shelves too", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => chat({ id }));
    const sections = { active: [a, b], snoozed: [c], settled: [d] };
    const moved = draftsFirst(
      sections,
      [a, b, c, d],
      new Set(["b", "d"]),
      new Map(),
    );
    expect(moved.active.map((x) => x.id)).toEqual(["b", "d", "a"]);
    expect(moved.snoozed).toEqual([c]);
    expect(moved.settled).toEqual([]);
  });

  it("keeps a thread on top once its draft is gone, until something passes it", () => {
    const a = chat({ id: "a", updated: 9_000 });
    const b = chat({ id: "b", updated: 5_000 });
    const sections = {
      active: [a, b],
      snoozed: [] as ChatSummary[],
      settled: [] as ChatSummary[],
    };
    const order = (at: number) =>
      draftsFirst(
        sections,
        [a, b],
        new Set(),
        new Map([["b", { at, sent: false }]]),
      ).active.map((x) => x.id);
    expect(order(8_000)).toEqual(["a", "b"]);
    expect(order(9_500)).toEqual(["b", "a"]);
  });

  it("sends a shelved thread back when its draft is cleared, not when it went out", () => {
    const a = chat({ id: "a", updated: 9_000 });
    const s = chat({ id: "s", updated: 4_000, settledAt: 4_500 });
    const z = chat({
      id: "z",
      updated: 4_000,
      snoozedAt: 4_500,
      snoozedUntil: 99_000,
    });
    const sections = { active: [a], snoozed: [z], settled: [s] };
    const place = (sent: boolean, settledAt = 4_500) => {
      const settled = { ...s, settledAt };
      const moved = draftsFirst(
        { ...sections, settled: [settled] },
        [a, settled, z],
        new Set(),
        new Map([
          ["s", { at: 9_500, sent }],
          ["z", { at: 9_500, sent }],
        ]),
      );
      return [moved.active, moved.snoozed, moved.settled].map((list) =>
        list.map((x) => x.id),
      );
    };
    expect(place(false)).toEqual([["a"], ["z"], ["s"]]);
    expect(place(true)).toEqual([["s", "z", "a"], [], []]);
    // Settled again after it went out, it stays on the shelf.
    expect(place(true, 9_800)).toEqual([["z", "a"], [], ["s"]]);
  });
});
