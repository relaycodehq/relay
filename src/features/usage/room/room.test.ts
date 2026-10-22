import { describe, expect, it } from "vitest";
import type { AgentAccount } from "../../../../shared/agent-accounts";
import {
  SESSION_MS,
  WEEK_MS,
  type ProviderUsage,
  type SavedResets,
} from "../../../../shared/provider-usage";
import { roomAccounts, roomiest, tankWords, windowName } from "./room";

const now = new Date(2026, 9, 14, 14, 20).getTime();
const HOUR = 3_600_000;

const account = (
  provider: "claude" | "codex" | "antigravity",
  id: string,
  label: string,
  signedIn = true,
): AgentAccount => ({
  provider,
  id,
  label,
  system: id === "default",
  signedIn,
});

const usage = (
  provider: "claude" | "codex" | "antigravity",
  used: { session?: number; weekly?: number },
  resets: SavedResets | null = null,
): ProviderUsage => ({
  provider,
  message: null,
  windows: [
    ...(used.weekly == null
      ? []
      : [
          {
            kind: "weekly" as const,
            usedPercent: used.weekly,
            resetsAt: now + 3 * 24 * HOUR,
            periodMs: WEEK_MS,
          },
        ]),
    ...(used.session == null
      ? []
      : [
          {
            kind: "session" as const,
            usedPercent: used.session,
            resetsAt: now + 3 * HOUR,
            periodMs: SESSION_MS,
          },
        ]),
  ],
  resets,
});

describe("which accounts show", () => {
  it("shows signed-in accounts with limits, by agent name until an agent has several", () => {
    const list = roomAccounts(
      [
        account("claude", "default", "Default"),
        account("codex", "default", "Default"),
        account("codex", "other", "Other"),
        account("codex", "gone", "Gone", false),
      ],
      (provider, id) =>
        id === "other"
          ? { provider, windows: [], message: "Sign in with codex" }
          : usage(provider, { session: 10, weekly: 30 }),
      now,
    );
    expect(list.map((a) => a.name)).toEqual(["Claude", "Default"]);
    // Shortest limit first, whatever order the reading had.
    expect(list[0]!.tanks.map((t) => windowName(t.window.periodMs))).toEqual([
      "5h",
      "Week",
    ]);
  });

  it("lights the account with the most room before any limit stops it", () => {
    const [a, b] = roomAccounts(
      [
        account("claude", "default", "Default"),
        account("codex", "default", "Default"),
      ],
      (provider) =>
        provider === "claude"
          ? usage(provider, { session: 0, weekly: 70 })
          : usage(provider, { session: 40, weekly: 40 }),
      now,
    );
    expect(roomiest([a!, b!])).toBe(b);
  });
});

it("says an empty limit is back at its reset, and one with room resets then", () => {
  const [a] = roomAccounts(
    [account("codex", "default", "Default")],
    () => usage("codex", { session: 100, weekly: 50 }),
    now,
  );
  expect(tankWords(a!.tanks[0]!, now)).toMatchObject({
    title: "5 hours",
    left: "0% left",
    end: "back at 17:20",
  });
  expect(tankWords(a!.tanks[1]!, now).end).toBe("resets Sat 14:20");
});
