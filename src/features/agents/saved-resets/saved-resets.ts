import type {
  CodexResetOutcome,
  SavedResets,
} from "../../../../shared/provider-usage";

const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const resetCount = (n: number) =>
  `${n} saved ${n === 1 ? "reset" : "resets"}`;

/** "one runs out Oct 22", "no expiry"; null when Codex only gave a count. */
export function expiryWords(resets: SavedResets) {
  if (!resets.credits.length) return null;
  const dated = resets.credits.flatMap((c) =>
    c.expiresAt == null ? [] : [c.expiresAt],
  );
  if (!dated.length) return "no expiry";
  const first = dayLabel(Math.min(...dated));
  if (resets.count === 1) return `runs out ${first}`;
  return `${dated.length === 1 ? "one" : "first"} runs out ${first}`;
}

/** The reset to spend: the first to lapse, as Codex listed them. */
export const firstToLapse = (resets: SavedResets) => resets.credits[0] ?? null;

/** One click's request: Codex's idempotency key and the reset it asked for. */
export type ResetAttempt = { key: string; creditId: string | null };

/**
 * The attempt to send again on the next click: none once Codex gave a clear
 * answer, the same one when it didn't, because an answer Relay doesn't know
 * may have spent the reset and only the same key can't spend a second. The
 * reset asked for stays too: the reading after a spent one lists the next.
 */
export function attemptAfter(
  attempt: ResetAttempt,
  outcome: CodexResetOutcome,
): ResetAttempt | null {
  switch (outcome) {
    case "reset":
    case "nothingToReset":
    case "noCredit":
    case "alreadyRedeemed":
      return null;
    default:
      return attempt;
  }
}

/** What to say when Codex didn't spend the reset; null when it did. */
export function outcomeWords(outcome: CodexResetOutcome) {
  switch (outcome) {
    case "reset":
      return null;
    case "nothingToReset":
      return "Codex says these limits don’t need a reset right now.";
    case "noCredit":
      return "There are no saved resets left on this account.";
    case "alreadyRedeemed":
      return "That reset was already used. Check again to see what’s left.";
    default:
      return "Codex answered in a way Relay doesn’t know. Check again to see whether it went through.";
  }
}
