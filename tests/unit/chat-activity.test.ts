import { describe, expect, it, vi } from "vitest";
import {
  chatActivitySection,
  chatActivitySections,
  chatIsEmpty,
  shortAge,
  snoozePresets,
  wakeLabel,
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

  it("keeps the latest settled threads on the shelf, not the latest updated", () => {
    const hour = 3_600_000;
    const recent = Array.from({ length: 16 }, (_, i) =>
      chat({
        id: `recent-${i}`,
        updated: 100 * hour - i * hour,
        settledAt: 100 * hour - i * hour + 1,
      }),
    );
    // Its last message is older than all the others, but it was settled last.
    const justSettled = chat({
      id: "old",
      updated: 10 * hour,
      settledAt: 101 * hour,
    });
    const { settled } = chatActivitySections(
      [...recent, justSettled],
      102 * hour,
    );
    expect(settled).toHaveLength(15);
    expect(settled[0].id).toBe("old");
    expect(settled.map((c) => c.id)).not.toContain("recent-15");
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

  it("names the wake day right when the clocks change", () => {
    vi.stubEnv("TZ", "Europe/Prague");
    try {
      // Clocks go back on 25 October 2026, so that day lasts 25 hours.
      const fallBack = new Date(2026, 9, 25, 10);
      expect(
        wakeLabel(new Date(2026, 9, 25, 23, 30).getTime(), fallBack),
      ).not.toMatch(/tomorrow/);
      // They go forward on 28 March 2027, a 23-hour day.
      const springForward = new Date(2027, 2, 28, 10);
      expect(
        wakeLabel(new Date(2027, 2, 29, 0, 30).getTime(), springForward),
      ).toMatch(/^tomorrow /);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
