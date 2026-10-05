import { describe, expect, it } from "vitest";
import {
  attention,
  familyLine,
  familySettled,
  nextAfterSettle,
  startedFamilies,
  triaged,
} from "./activity";
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

describe("startedFamilies", () => {
  it("puts started threads under a listed lead, in the order they started", () => {
    const lead = chat({ id: "lead", updated: 1_000 });
    const second = chat({
      id: "b",
      created: 3_000,
      startedBy: { chatId: "lead", agent: "codex" },
    });
    const first = chat({
      id: "a",
      created: 2_000,
      startedBy: { chatId: "lead", agent: "claude" },
    });
    const orphan = chat({
      id: "o",
      startedBy: { chatId: "settled-lead", agent: "claude" },
    });
    const { top, started } = startedFamilies([second, orphan, lead, first]);
    expect(top.map((c) => c.id)).toEqual(["o", "lead"]);
    expect(started.get("lead")!.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("familyLine", () => {
  it("says how many work and how many need you", () => {
    expect(
      familyLine([
        chat({ running: true }),
        chat({ running: true, waiting: true }),
        chat(),
        chat(),
      ]),
    ).toBe("4 threads · 1 working · 1 needs you");
    expect(familyLine([chat()])).toBe("1 thread · all done");
  });
});

describe("familySettled", () => {
  it("folds a family once every thread in it is done and read", () => {
    const read = () => false;
    expect(familySettled([chat(), chat()], read)).toBe(true);
    expect(familySettled([chat(), chat({ running: true })], read)).toBe(false);
    expect(familySettled([chat({ id: "new" })], (c) => c.id === "new")).toBe(
      false,
    );
  });
});
