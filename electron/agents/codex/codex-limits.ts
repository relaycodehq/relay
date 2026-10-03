import { z } from "zod";
import { CodexAppServerRequestError } from "../../vendor/t3code/codex/errors";
import { signedOutError, usageLimitError } from "../errors";
import { latestReset, resetMs } from "../usage-limit";

const windowSchema = z
  .object({ usedPercent: z.number(), resetsAt: z.number().nullish() })
  .nullish();
const snapshotSchema = z.object({
  primary: windowSchema,
  secondary: windowSchema,
});
const turnErrorSchema = z.object({
  message: z.string().nullish(),
  codexErrorInfo: z.unknown(),
});

/** When the spent windows of an `account/rateLimits/updated` snapshot lift. */
export function codexSpentUntil(limits: unknown): number | undefined {
  const snapshot = snapshotSchema.safeParse(limits);
  if (!snapshot.success) return;
  const { primary, secondary } = snapshot.data;
  return latestReset(
    [primary, secondary]
      .filter((w) => w && w.usedPercent >= 100)
      .map((w) => resetMs(w!.resetsAt)),
  );
}

/** The error a failed turn ends in; a spent plan lifts at `spentUntil`. */
export function codexFailure(
  error: unknown,
  fallback: string,
  spentUntil?: number,
) {
  const parsed = turnErrorSchema.safeParse(error);
  const message = (parsed.success && parsed.data.message) || undefined;
  const info = parsed.success ? parsed.data.codexErrorInfo : undefined;
  if (info === "usageLimitExceeded")
    return usageLimitError(
      "codex",
      message ?? "Codex hit its usage limit.",
      spentUntil,
    );
  // Codex names a rejected login itself; its own words say where, not what to do.
  if (info === "unauthorized") return signedOutError("codex");
  return new Error(message ?? fallback);
}

/**
 * A request Codex answered with a JSON-RPC error. Its schema leaves `data` open,
 * so a rejected login is read from `codexErrorInfo` when it's there and from the
 * HTTP 401 in the message when it isn't; anything else stays as it came.
 */
export function codexRequestFailure(error: unknown) {
  if (!(error instanceof CodexAppServerRequestError)) return error;
  const data = turnErrorSchema.safeParse(error.data);
  if (
    (data.success && data.data.codexErrorInfo === "unauthorized") ||
    /\b401\b|unauthori[sz]ed/i.test(error.errorMessage)
  )
    return signedOutError("codex");
  return error;
}
