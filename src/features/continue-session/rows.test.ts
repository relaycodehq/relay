import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { matchingSessions, sessionDetail } from "./rows";

const NOW = Date.parse("2026-10-06T12:00:00Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const session = (over: Partial<TerminalSession> = {}): TerminalSession => ({
  provider: "claude",
  id: "s1",
  title: "Fix the cache guard",
  updated: NOW - 2 * 3_600_000,
  turns: 14,
  account: "default",
  live: false,
  ...over,
});

it("says the agent, when, how long, and what picking it will do", () => {
  expect(sessionDetail(session())).toBe("Claude · 2h ago · 14 turns");
  expect(
    sessionDetail(
      session({ turns: 1, live: true, updated: NOW, accountLabel: "Work" }),
    ),
  ).toBe(
    "Claude · just now · 1 turn · Work · open in a terminal, continues as a copy",
  );
  // Codex can't say whether a terminal holds it, so it always goes on in a copy.
  expect(
    sessionDetail(session({ provider: "codex", updated: NOW - 59_000 })),
  ).toBe("Codex · just now · 14 turns · continues as a copy");
  expect(
    sessionDetail(session({ provider: "codex", updated: NOW - 61_000 })),
  ).toBe("Codex · 1m ago · 14 turns · continues as a copy");
  // Already a thread: picking opens it, so whether it's live doesn't matter.
  expect(sessionDetail(session({ live: true, chatId: "c1" }))).toBe(
    "Claude · 2h ago · 14 turns · in Relay",
  );
});

it("matches every typed word against the title and the agent", () => {
  const rows = [
    session(),
    session({ id: "s2", provider: "codex", title: "Docs pass" }),
  ];
  expect(matchingSessions(rows, "codex docs").map((r) => r.id)).toEqual(["s2"]);
  expect(matchingSessions(rows, "  CACHE  ").map((r) => r.id)).toEqual(["s1"]);
  expect(matchingSessions(rows, "")).toHaveLength(2);
});
