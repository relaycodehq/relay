import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/api", () => ({ api: {} }));
import { ringState } from "../../src/components/UsageRing";
import { SESSION_MS, WEEK_MS } from "../../shared/provider-usage";

const now = Date.parse("2026-09-22T12:00:00Z");

it("presents both windows and takes the worst pace for the trigger", () => {
  const state = ringState(
    {
      provider: "claude",
      message: null,
      windows: [
        {
          kind: "session",
          usedPercent: 40,
          resetsAt: now + 2 * 60 * 60 * 1000,
          periodMs: SESSION_MS,
        },
        {
          kind: "weekly",
          usedPercent: 95,
          resetsAt: now + 5 * 24 * 60 * 60 * 1000,
          periodMs: WEEK_MS,
        },
      ],
    },
    now,
  );
  expect(state?.meters.map((m) => [m.kind, m.leftPercent])).toEqual([
    ["session", 60],
    ["weekly", 5],
  ]);
  expect(state?.pace).toBe("hot");
  expect(state?.label).toContain("Session 60% left");
  expect(state?.label).toContain("Weekly 5% left");
});

it("has nothing to draw before usage arrives or when no limits exist", () => {
  expect(ringState(undefined, now)).toBeNull();
  expect(
    ringState({ provider: "codex", windows: [], message: "Signed out" }, now),
  ).toBeNull();
});
