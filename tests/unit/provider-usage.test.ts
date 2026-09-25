import { describe, expect, it } from "vitest";
import {
  SESSION_MS,
  WEEK_MS,
  mapClaudeUsage,
  mapCodexUsage,
  presentWindow,
} from "../../shared/provider-usage";

const now = Date.parse("2026-09-22T12:00:00Z");

describe("provider usage windows", () => {
  it("reads Claude session and weekly limits and skips a missing session", () => {
    expect(
      mapClaudeUsage({
        five_hour: {
          utilization: 100,
          resets_at: "2026-09-22T13:25:00.000Z",
        },
        seven_day: { utilization: 16, resets_at: 1_758_000_000 },
      }),
    ).toEqual([
      {
        kind: "session",
        usedPercent: 100,
        resetsAt: Date.parse("2026-09-22T13:25:00.000Z"),
        periodMs: SESSION_MS,
      },
      {
        kind: "weekly",
        usedPercent: 16,
        resetsAt: 1_758_000_000_000,
        periodMs: WEEK_MS,
      },
    ]);
    expect(
      mapClaudeUsage({ five_hour: null, seven_day: { utilization: 4 } }).map(
        (window) => window.kind,
      ),
    ).toEqual(["weekly"]);
  });

  it("classifies Codex windows by duration and keeps a weekly-only limit weekly", () => {
    expect(
      mapCodexUsage(
        {
          rate_limit: {
            primary_window: {
              used_percent: 12,
              limit_window_seconds: 18_000,
              reset_at: 1_758_000_000,
            },
            secondary_window: {
              used_percent: 30,
              limit_window_seconds: 604_800,
              reset_after_seconds: 120,
            },
          },
        },
        now,
      ).map((window) => [window.kind, window.usedPercent, window.resetsAt]),
    ).toEqual([
      ["session", 12, 1_758_000_000_000],
      ["weekly", 30, now + 120_000],
    ]);
    expect(
      mapCodexUsage(
        {
          rate_limit: {
            primary_window: {
              used_percent: 40,
              limit_window_seconds: 604_800,
            },
          },
        },
        now,
      ).map((window) => window.kind),
    ).toEqual(["weekly"]);
    expect(
      mapCodexUsage({ rate_limit: {} }, now, { primary: 7, secondary: 9 }).map(
        (window) => [window.kind, window.usedPercent],
      ),
    ).toEqual([
      ["session", 7],
      ["weekly", 9],
    ]);
  });

  it("shows a reached limit, a burn-rate warning, and a session that has not started", () => {
    const spent = presentWindow(
      {
        kind: "session",
        usedPercent: 100,
        resetsAt: now + 85 * 60 * 1000,
        periodMs: SESSION_MS,
      },
      now,
    );
    expect(spent).toMatchObject({
      leftPercent: 0,
      pace: "spent",
      limitLabel: "Limit reached",
      resetLabel: "Resets in 1h 25m",
    });

    const weekly = presentWindow(
      {
        kind: "weekly",
        usedPercent: 16,
        resetsAt: now + (6 * 24 + 20) * 60 * 60 * 1000,
        periodMs: WEEK_MS,
      },
      now,
    );
    expect(weekly).toMatchObject({
      leftPercent: 84,
      // 164h of the 168h week still to go.
      paceLeftPercent: expect.closeTo(97.62, 2),
      pace: "hot",
      limitLabel: "Out in ~21h",
      resetLabel: "Resets in 6d 20h",
    });

    expect(
      presentWindow(
        {
          kind: "session",
          usedPercent: 0,
          resetsAt: null,
          periodMs: SESSION_MS,
        },
        now,
      ),
    ).toMatchObject({
      leftPercent: 100,
      pace: "ok",
      limitLabel: null,
      resetLabel: "Not started",
    });
  });
});
