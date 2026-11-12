import { describe, expect, it } from "vitest";
import { SESSION_MS, WEEK_MS } from "./provider-usage";
import {
  mapClaudeUsage,
  mapCodexResets,
  mapCodexUsage,
} from "./provider-usage-responses";

const now = Date.parse("2026-09-22T12:00:00Z");

describe("provider usage responses", () => {
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

  it("adds Claude's per-model weekly limits after the plan's", () => {
    expect(
      mapClaudeUsage({
        seven_day: { utilization: 49 },
        model_scoped: [
          { display_name: "Fable", utilization: 12, resets_at: null },
          { display_name: "Unknown", utilization: null, resets_at: null },
        ],
      }).map((window) => [window.model, window.label, window.usedPercent]),
    ).toEqual([
      [undefined, undefined, 49],
      ["Fable", "Fable · Weekly", 12],
    ]);
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
});

describe("Codex saved resets", () => {
  // As wham/usage and wham/rate-limit-reset-credits answered on 2026-10-14.
  const usage = (count: number, applicable?: number) => ({
    rate_limit_reset_credits: {
      available_count: count,
      ...(applicable == null ? {} : { applicable_available_count: applicable }),
    },
  });
  const credit = (id: string, expires: string | null, extra = {}) => ({
    id,
    reset_type: "codex_rate_limits",
    is_supported_by_plan: true,
    status: "available",
    granted_at: "2026-09-22T20:52:53.813010Z",
    expires_at: expires,
    title: "Full reset",
    ...extra,
  });

  it("lists the available ones, first to lapse first, and those without an end last", () => {
    expect(
      mapCodexResets(usage(3, 0), {
        available_count: 3,
        credits: [
          credit("never", null),
          credit("late", "2026-10-30T10:00:00.000000Z"),
          credit("soon", "2026-10-22T20:52:53.813010Z"),
          credit("spent", null, { status: "redeemed" }),
          credit("other-plan", null, { is_supported_by_plan: false }),
        ],
      }),
    ).toEqual({
      count: 3,
      usable: 0,
      credits: [
        { id: "soon", expiresAt: Date.parse("2026-10-22T20:52:53.813Z") },
        { id: "late", expiresAt: Date.parse("2026-10-30T10:00:00Z") },
        { id: "never", expiresAt: null },
      ],
    });
  });

  it("keeps the count when the list couldn't be read, and says nothing without any", () => {
    expect(mapCodexResets(usage(2))).toEqual({
      count: 2,
      usable: null,
      credits: [],
    });
    expect(mapCodexResets(usage(0, 0))).toBeNull();
    expect(mapCodexResets({ rate_limit: {} })).toBeNull();
  });
});
