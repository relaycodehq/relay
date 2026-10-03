import { expect, it } from "vitest";
import { agentsSince, summary } from "./waiting";
import type { ChatPending } from "./projects";

const now = Date.parse("2026-09-26T12:00:00Z");
const task = (description: string, minutes: number): ChatPending => ({
  kind: "task",
  id: description,
  description,
  since: now - minutes * 60_000,
});
const emulator = task("Cold boot the Android 14 emulator", 37);
const metro = task("Start Metro on port 8081", 30);
const watcher = task("Watch the socket", 12);

it("calls commands left after the turn running, not waited on", () => {
  const head = summary([emulator, metro, watcher], now);
  expect(head).toEqual({ title: "3 running in the background", detail: "" });
  expect(JSON.stringify(summary([emulator], now))).not.toMatch(/waiting/);
  expect(summary([emulator], now)).toEqual({
    title: "Cold boot the Android 14 emulator",
    detail: " · running in the background · 37m",
  });
});

it("counts wake-ups beside running commands, and leads with one when alone", () => {
  const wakeup: ChatPending = {
    kind: "wakeup",
    id: "w",
    prompt: "Check the build",
    recurring: false,
    at: now + 5 * 60_000,
  };
  expect(summary([emulator, metro, wakeup], now).detail).toBe(" · +1 wake-up");
  expect(summary([wakeup], now).detail).toBe(" · in 5m");
  expect(summary([wakeup], now).title).toMatch(/^Claude will check back at /);
});

it("counts a thread with subagents out as working, but not one with a dev server", () => {
  const agent = (minutes: number): ChatPending => ({
    kind: "task",
    id: `agent-${minutes}`,
    description: "Review the diff",
    since: now - minutes * 60_000,
    agent: true,
  });
  expect(agentsSince([metro, watcher])).toBeUndefined();
  expect(agentsSince([metro, agent(5), agent(9)])).toBe(now - 9 * 60_000);
});
