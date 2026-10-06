import { describe, expect, it } from "vitest";
import {
  SESSION_MS,
  WEEK_MS,
  creditsLabel,
  creditsReach,
  mapClaudeUsage,
  mapCodexCredits,
  mapCodexUsage,
  paceGap,
  presentWindow,
} from "./provider-usage";

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

  it("says how far the meter is from its pace mark", () => {
    // Half the week gone: an even burn leaves 50%.
    const week = (usedPercent: number) =>
      presentWindow(
        { kind: "weekly", usedPercent, resetsAt: now + WEEK_MS / 2, periodMs: WEEK_MS },
        now,
      );
    expect(paceGap(week(45))).toBe("5% ahead");
    expect(paceGap(week(53))).toBe("3% behind");
    expect(paceGap(week(50))).toBe("On pace");
    expect(paceGap(week(100))).toBeNull();
  });
});

describe("Codex credits", () => {
  // As wham/usage answered for a Free account with bought credits.
  const body = (credits: Record<string, unknown>) => ({
    plan_type: "free",
    credits: {
      has_credits: true,
      unlimited: false,
      overage_limit_reached: false,
      balance: "62500",
      approx_local_messages: [15625, 81250],
      ...credits,
    },
  });

  it("reads the balance and what it buys", () => {
    const credits = mapCodexCredits(body({}))!;
    expect(credits).toEqual({
      balance: 62500,
      unlimited: false,
      messages: [15625, 81250],
    });
    expect(creditsLabel(credits)).toBe("62,500 credits");
    expect(creditsReach(credits)).toBe("~15,625–81,250 messages");
  });

  it("has nothing to show for an empty or capped balance", () => {
    expect(
      mapCodexCredits(body({ has_credits: false, balance: "0" })),
    ).toBeNull();
    expect(mapCodexCredits(body({ overage_limit_reached: true }))).toBeNull();
    expect(mapCodexCredits({ rate_limit: {} })).toBeNull();
  });

  it("keeps unlimited credits without a balance", () => {
    const credits = mapCodexCredits(
      body({ unlimited: true, balance: null, approx_local_messages: null }),
    )!;
    expect(creditsLabel(credits)).toBe("Unlimited credits");
    expect(creditsReach(credits)).toBeNull();
  });
});
