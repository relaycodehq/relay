// Spends one of a Codex account's saved resets through its own app server, the
// call Codex's TUI makes. Only ever on the user's click: Relay never picks the
// moment, and never retries on its own.
import { homedir } from "node:os";
import { z } from "zod";
import type {
  CodexResetOutcome,
  CodexResetResult,
} from "../../../shared/provider-usage";
import { accountFor, signedInAs } from "../accounts";
import { withAppServer } from "../provider-commands";
import { readProviderUsage } from "../provider-usage";
import { codexRequestFailure } from "./codex-limits";
import type { CodexTransport } from "./codex-transport";

const known = new Set<string>([
  "reset",
  "nothingToReset",
  "noCredit",
  "alreadyRedeemed",
]);

/**
 * One consume request. `attempt` is Codex's idempotency key: the same key
 * sent again can't spend a second reset, so a retry after an unclear failure
 * must reuse it.
 */
export async function consumeReset(
  wire: CodexTransport,
  creditId: string | null,
  attempt: string,
): Promise<CodexResetOutcome> {
  const { outcome } = await wire.call(
    "account/rateLimitResetCredit/consume",
    { idempotencyKey: attempt, creditId },
    z.object({ outcome: z.string() }),
  );
  return known.has(outcome) ? (outcome as CodexResetOutcome) : "unknown";
}

/** Spends `creditId`, or the next one Codex picks, on `account`, then reads its limits again. */
export async function redeemCodexReset(
  account: string,
  creditId: string | null,
  attempt: string,
): Promise<CodexResetResult> {
  // A removed account's folder mustn't be made again just to ask.
  if (accountFor("codex", account) !== account)
    throw new Error("That Codex account isn't signed in here anymore.");
  const env = await signedInAs("codex", account);
  let outcome: CodexResetOutcome;
  try {
    outcome = await withAppServer(
      homedir(),
      "using a saved reset",
      (wire) => consumeReset(wire, creditId, attempt),
      { env, timeoutMs: 30_000 },
    );
  } catch (error) {
    throw codexRequestFailure(error);
  }
  return { outcome, usage: await readProviderUsage("codex", true, account) };
}
