import { describe, expect, it, vi } from "vitest";
import {
  autoSettledAt,
  chatActivitySection,
  chatActivitySections,
  chatIsEmpty,
  shortAge,
  sentLabel,
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

  it("labels when a message was sent by how far back its day is", () => {
    const now = new Date(2026, 8, 24, 9, 0);
    const at = (d: number, h = 13, y = 2026, mo = 8) =>
      sentLabel(new Date(y, mo, d, h, 25).getTime(), now);
    expect(at(24, 8)).toBe(
      new Date(2026, 8, 24, 8, 25).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    expect(at(23, 23)).toMatch(/^Yesterday /);
    const tuesday = new Date(2026, 8, 22).toLocaleDateString(undefined, {
      weekday: "long",
    });
    expect(at(22).startsWith(`${tuesday} `)).toBe(true);
    expect(at(17)).toMatch(/17/);
    expect(at(17)).not.toMatch(/2026/);
    expect(at(17, 13, 2025)).toMatch(/2025/);
  });
});

describe("auto-settle", () => {
  const day = 86_400_000;
  const quiet = chat({ updated: 1_000 });
  it("settles a thread quiet for the set days, dated to its last activity", () => {
    expect(autoSettledAt(quiet, 1_000 + 3 * day, 3)).toBe(1_000);
    expect(autoSettledAt(quiet, 1_000 + 3 * day - 1, 3)).toBeUndefined();
    expect(autoSettledAt(quiet, 1_000 + 90 * day, null)).toBeUndefined();
  });

  it("settles once its PR merged after the last activity", () => {
    const merged = (at: number) =>
      chat({ updated: 1_000, worktree: { landed: { at, by: "pr" } } });
    expect(autoSettledAt(merged(2_000), 3_000, 3)).toBe(2_000);
    expect(autoSettledAt(merged(500), 3_000, 3)).toBeUndefined();
  });

  it("leaves a thread alone while something is going on or about to", () => {
    const later = 1_000 + 30 * day;
    for (const patch of [
      { running: true },
      { waiting: true },
      { nextSend: later + day },
      { autoSettleOff: true as const },
      { archivedAt: 2_000 },
      { snoozedAt: 1_000, snoozedUntil: later + day },
      {
        pending: [
          {
            kind: "task" as const,
            id: "t",
            description: "dev server",
            since: 1_000,
          },
        ],
      },
    ])
      expect(
        autoSettledAt(chat({ updated: 1_000, ...patch }), later, 3),
      ).toBeUndefined();
  });

  it("keeps a thread moved back by hand out until newer activity", () => {
    const later = 1_000 + 30 * day;
    expect(
      autoSettledAt(chat({ updated: 1_000, unsettledAt: 5_000 }), later, 3),
    ).toBeUndefined();
    expect(
      autoSettledAt(
        chat({ updated: 6_000, unsettledAt: 5_000 }),
        6_000 + 3 * day,
        3,
      ),
    ).toBe(6_000);
  });
});
