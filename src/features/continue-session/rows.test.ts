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

it("matches typed words against the title, the agent and where it ran", () => {
  const rows = [
    session(),
    session({ id: "s2", provider: "codex", title: "Docs pass" }),
    session({ id: "s3", provider: "codex", title: "Claude docs", app: true }),
  ];
  const ids = (search: string) =>
    matchingSessions(rows, search).map((r) => r.id);
  expect(ids("codex docs")).toEqual(["s2", "s3"]);
  expect(ids("claude")).toEqual(["s1"]);
  expect(ids("codex app")).toEqual(["s3"]);
  expect(ids("terminal docs")).toEqual(["s2"]);
  expect(ids("  CACHE  ")).toEqual(["s1"]);
  expect(ids("")).toHaveLength(3);
});
