import { expect, it } from "vitest";
import { parseGoalCommand, presentGoal, type ThreadGoal } from "./goal";

it("reads /goal the way both agents do", () => {
  expect(parseGoalCommand("/goal")).toEqual({ type: "show" });
  expect(parseGoalCommand(" /goal Pause ")).toEqual({ type: "pause" });
  expect(parseGoalCommand("/goal resume")).toEqual({ type: "resume" });
  // Claude Code's words for clearing work for Codex too.
  expect(parseGoalCommand("/goal off")).toEqual({ type: "clear" });
  expect(parseGoalCommand("/goal all tests in test/auth pass")).toEqual({
    type: "set",
    objective: "all tests in test/auth pass",
  });
  expect(parseGoalCommand("/goals")).toBeNull();
  expect(parseGoalCommand("set a /goal")).toBeNull();
});

const codex: ThreadGoal = {
  provider: "codex",
  objective: "Ship it",
  status: "active",
  tokensUsed: 41_200,
  tokenBudget: 200_000,
  timeUsedSeconds: 380,
  updated: 1,
};

it("offers Pause while a Codex goal runs and Resume once it stops short", () => {
  expect(presentGoal(codex, true)).toMatchObject({
    title: "Pursuing goal",
    usage: "41k / 200k tokens · 6m",
    canPause: true,
    canResume: false,
    canClear: true,
    working: true,
  });
  for (const status of ["paused", "blocked", "usage_limited"] as const)
    expect(presentGoal({ ...codex, status }, false)).toMatchObject({
      canPause: false,
      canResume: true,
    });
  // As in Codex's TUI, over budget it only clears.
  expect(
    presentGoal({ ...codex, status: "budget_limited" }, false),
  ).toMatchObject({ canResume: false, canClear: true });
  expect(presentGoal({ ...codex, status: "complete" }, false)).toMatchObject({
    title: "Goal complete",
    canResume: false,
    canClear: false,
  });
});

it("offers Claude's goal only Clear, and only between turns", () => {
  const claude: ThreadGoal = {
    provider: "claude",
    objective: "Ship it",
    status: "active",
    checks: 2,
    updated: 1,
  };
  expect(presentGoal(claude, true)).toMatchObject({
    usage: "2 checks",
    canPause: false,
    canClear: false,
  });
  expect(presentGoal(claude, false)).toMatchObject({
    title: "Goal set",
    canResume: false,
    canClear: true,
  });
  expect(
    presentGoal({ ...claude, gaveUp: true, lastCheck: "Not yet." }, false),
  ).toMatchObject({ title: "Goal not met yet", detail: "Not yet." });
});
