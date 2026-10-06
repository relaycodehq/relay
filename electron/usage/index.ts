// Relay's local usage log. Nothing is kept until main points it at a file.
import type { UsageEntry } from "../../shared/usage";
import { UsageLedger } from "./ledger";

let ledger: UsageLedger | null = null;

export function keepUsageLog(file: string) {
  ledger = new UsageLedger(file);
}

export function logUsage(entry: UsageEntry) {
  ledger?.add(entry);
}

export function usageLog(): Promise<readonly UsageEntry[]> {
  return ledger ? ledger.all() : Promise.resolve([]);
}
