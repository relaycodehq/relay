import { describe, expect, it } from "vitest";
import type { SavedResets } from "../../../../shared/provider-usage";
import { attemptAfter, expiryWords } from "./saved-resets";

const resets = (
  count: number,
  expires: (number | null)[] = [],
  usable: number | null = null,
): SavedResets => ({
  count,
  usable,
  credits: expires.map((expiresAt, i) => ({ id: `r${i}`, expiresAt })),
});

describe("saved resets", () => {
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

it("keeps a reset's key and reset until Codex answers clearly, so a retry can't spend two", () => {
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
