import { describe, expect, it } from "vitest";
import {
  chatActivitySection,
  chatIsEmpty,
  shortAge,
  snoozePresets,
} from "../../shared/chat-activity";
import type { ChatSummary } from "../../shared/projects";

const chat = (patch: Partial<ChatSummary> = {}): ChatSummary => ({
  id: "c",
  projectId: "p",
  title: "Thread",
  scope: { kind: "project" },
  created: 1_000,
  updated: 5_000,
  ...patch,
});

describe("chat activity", () => {
  it("keeps a settled thread settled until newer activity", () => {
    expect(chatActivitySection(chat({ settledAt: 6_000 }), 10_000)).toBe(
      "settled",
    );
    expect(
      chatActivitySection(chat({ settledAt: 6_000, updated: 7_000 }), 10_000),
    ).toBe("active");
  });

  it("never hides a running or blocked thread as settled", () => {
    expect(
      chatActivitySection(chat({ settledAt: 6_000, running: true }), 10_000),
    ).toBe("active");
    expect(
      chatActivitySection(chat({ settledAt: 6_000, waiting: true }), 10_000),
    ).toBe("active");
  });

  it("wakes a snoozed thread on its timer, new activity or a request", () => {
    const snoozed = { snoozedAt: 6_000, snoozedUntil: 20_000 };
    expect(chatActivitySection(chat(snoozed), 10_000)).toBe("snoozed");
    expect(chatActivitySection(chat(snoozed), 20_000)).toBe("active");
    expect(
      chatActivitySection(chat({ ...snoozed, updated: 8_000 }), 10_000),
    ).toBe("active");
    expect(
      chatActivitySection(chat({ ...snoozed, waiting: true }), 10_000),
    ).toBe("active");
  });

  it("treats unused threads as empty but keeps shared ones", () => {
    expect(chatIsEmpty(chat({ empty: true }))).toBe(true);
    expect(chatIsEmpty(chat({ updated: 1_000 }))).toBe(true);
    expect(chatIsEmpty(chat())).toBe(false);
    expect(
      chatIsEmpty(
        chat({
          empty: true,
          shared: { roomId: "r", server: "s", memberId: "m" },
        }),
      ),
    ).toBe(false);
  });

  it("offers future snooze presets and skips a passed evening", () => {
    const morning = new Date(2026, 8, 22, 10, 0);
    const presets = snoozePresets(morning);
    expect(presets.map((p) => p.id)).toEqual([
      "hour",
      "three-hours",
      "evening",
      "tomorrow",
      "next-week",
    ]);
    for (const p of presets) expect(p.until).toBeGreaterThan(morning.getTime());
    expect(new Date(presets.at(-1)!.until).getDay()).toBe(1);
    expect(
      snoozePresets(new Date(2026, 8, 22, 19, 0)).map((p) => p.id),
    ).not.toContain("evening");
  });

  it("formats compact ages", () => {
    expect(shortAge(0, 30_000)).toBe("now");
    expect(shortAge(0, 5 * 60_000)).toBe("5m");
    expect(shortAge(0, 3 * 3_600_000)).toBe("3h");
    expect(shortAge(0, 2 * 86_400_000)).toBe("2d");
  });
});
