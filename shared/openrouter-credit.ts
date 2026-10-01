// What OpenRouter reports for the key OpenCode uses: the account's credit and
// the key's own spending cap. Pay-as-you-go has no windows, so it reads in dollars.
import { z } from "zod";
import type { MeterPace } from "./provider-usage";

const dollars = z.number().finite();

export const openRouterCreditSchema = z
  .object({
    /** Credit left on the account: everything bought minus everything spent. */
    balance: dollars.nullable(),
    /** The key's own cap, when it has one; OpenRouter resets it on its own. */
    limit: z
      .object({
        amount: dollars,
        remaining: dollars,
        reset: z.enum(["daily", "weekly", "monthly"]).nullable(),
      })
      .nullable(),
    /** What this key spent today, this week and this month, in UTC. */
    spent: z.object({ day: dollars, week: dollars, month: dollars }).nullable(),
    message: z.string().max(160).nullable(),
  })
  .strict();
export type OpenRouterCredit = z.infer<typeof openRouterCreditSchema>;

export function formatDollars(value: number) {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(abs) ? 0 : 2;
  return `${value < 0 ? "−" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** What can still be spent: whichever of the balance and the key's cap runs out first. */
export function creditLeft(credit: OpenRouterCredit): number | null {
  const left = [credit.balance, credit.limit?.remaining].filter(
    (v): v is number => v != null,
  );
  return left.length ? Math.max(0, Math.min(...left)) : null;
}

/** Hot once today's spend alone would use up what's left, warm at this week's. */
export function creditPace(credit: OpenRouterCredit): MeterPace {
  const left = creditLeft(credit);
  if (left == null) return "ok";
  if (left <= 0.01) return "spent";
  if (!credit.spent) return "ok";
  if (credit.spent.day >= left) return "hot";
  return credit.spent.week >= left ? "warn" : "ok";
}

/** When the key's cap starts over; OpenRouter counts days and months in UTC. */
export function limitResetsAt(
  reset: "daily" | "weekly" | "monthly",
  now: number,
): number | null {
  const d = new Date(now);
  if (reset === "daily")
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  if (reset === "monthly")
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return null;
}
