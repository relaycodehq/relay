import { z } from "zod";
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
