import { describe, expect, it } from "vitest";
import type { AgentAccount } from "../../../../shared/agent-accounts";
import {
  SESSION_MS,
  WEEK_MS,
  type ProviderUsage,
  type SavedResets,
} from "../../../../shared/provider-usage";
import {
  attemptAfter,
  canRefill,
  expiryWords,
  roomAccounts,
  roomiest,
  tankWords,
  windowName,
  type RoomAccount,
} from "./room";

const now = new Date(2026, 9, 14, 14, 20).getTime();
const HOUR = 3_600_000;

const account = (
  provider: "claude" | "codex" | "antigravity",
  id: string,
  label: string,
  signedIn = true,
): AgentAccount => ({ provider, id, label, system: id === "default", signedIn });

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

const resets = (
  count: number,
  expires: (number | null)[] = [],
  usable: number | null = null,
): SavedResets => ({
  count,
  usable,
  credits: expires.map((expiresAt, i) => ({ id: `r${i}`, expiresAt })),
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
      [account("claude", "default", "Default"), account("codex", "default", "Default")],
      (provider) =>
        provider === "claude"
          ? usage(provider, { session: 0, weekly: 70 })
          : usage(provider, { session: 40, weekly: 40 }),
      now,
    );
    expect(roomiest([a!, b!])).toBe(b);
  });
});

describe("offering a saved reset", () => {
  const codex = (used: { session?: number; weekly?: number }, r: SavedResets | null) =>
    roomAccounts(
      [account("codex", "default", "Default")],
      () => usage("codex", used, r),
      now,
    )[0] as RoomAccount;

  it("offers one on a low account even when Codex counts none it would apply", () => {
    expect(canRefill(codex({ weekly: 95 }, resets(1, [], 0)))).toBe(true);
  });

  it("follows Codex's count while there's room, and falls back to any use without it", () => {
    expect(canRefill(codex({ weekly: 40 }, resets(1, [], 0)))).toBe(false);
    expect(canRefill(codex({ weekly: 40 }, resets(1, [], 1)))).toBe(true);
    expect(canRefill(codex({ weekly: 40 }, resets(1)))).toBe(true);
    expect(canRefill(codex({ weekly: 2 }, resets(1)))).toBe(false);
    expect(canRefill(codex({ weekly: 99 }, null))).toBe(false);
  });

  it("says when the first one lapses, or nothing when only the count is known", () => {
    const oct22 = new Date(2026, 9, 22).getTime();
    expect(expiryWords(resets(1, [oct22]))).toBe("runs out Oct 22");
    expect(expiryWords(resets(2, [oct22, null]))).toBe("one runs out Oct 22");
    expect(expiryWords(resets(2, [oct22, oct22 + 1]))).toBe(
      "first runs out Oct 22",
    );
    expect(expiryWords(resets(1, [null]))).toBe("no expiry");
    expect(expiryWords(resets(3))).toBeNull();
  });
});

it("says an empty limit is back at its reset, and one with room refills then", () => {
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
  expect(tankWords(a!.tanks[1]!, now).end).toBe("refills Sat 14:20");
});

it("keeps a refill's key and reset until Codex answers clearly, so a retry can't spend two", () => {
  const sent = { key: "attempt-1", creditId: "r0" };
  // An answer Relay doesn't know may have spent it: the retry sends the same.
  expect(attemptAfter(sent, "unknown")).toBe(sent);
  for (const clear of [
    "reset",
    "nothingToReset",
    "noCredit",
    "alreadyRedeemed",
  ] as const)
    expect(attemptAfter(sent, clear)).toBeNull();
});
