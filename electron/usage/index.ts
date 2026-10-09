// Relay's local usage log. Nothing is kept until main points it at a file.
import type { UsageEntry } from "../../shared/usage";
import { listCost, promptOf } from "../agents/watch/prices";
import { UsageLedger } from "./ledger";

let ledger: UsageLedger | null = null;

export function keepUsageLog(file: string) {
  ledger = new UsageLedger(file);
}

export function logUsage(entry: UsageEntry) {
  ledger?.add(entry);
}

/**
 * Lines written before a model had a price stay unpriced in the file, so they
 * are priced again here from their tokens; the file itself is never rewritten.
 */
function priceUnpriced(entry: UsageEntry): UsageEntry {
  const models = Object.fromEntries(
    Object.entries(entry.models).map(([model, spend]) => {
      if (spend.usd !== undefined) return [model, spend];
      // A line sums a run's requests; their average prompt picks the tier.
      const prompt = promptOf(spend.tokens) / Math.max(1, spend.requests);
      const usd = listCost(model, spend.tokens, { prompt });
      return [model, usd === undefined ? spend : { ...spend, usd }];
    }),
  );
  return { ...entry, models };
}

export async function usageLog(): Promise<readonly UsageEntry[]> {
  const entries = ledger ? await ledger.all() : [];
  return entries.map(priceUnpriced);
}
