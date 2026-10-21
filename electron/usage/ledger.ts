import { JsonLines } from "../util/json-lines";
import type { UsageEntry } from "../../shared/usage";

/**
 * What the agents used, one JSON line per run, kept on this computer for the
 * Usage page. Nothing here leaves it. A line is a few hundred bytes, so a
 * busy year stays in the low megabytes and nothing is ever pruned.
 */
export class UsageLedger {
  private records: JsonLines<UsageEntry>;
  private writing = Promise.resolve();

  constructor(path: string) {
    this.records = new JsonLines(path);
  }

  add(entry: UsageEntry) {
    this.writing = this.records
      .append(entry)
      .catch((e) => console.warn("Could not log what an agent used:", e));
  }

  /** Every entry, after the ones still being written. */
  async all(): Promise<readonly UsageEntry[]> {
    await this.writing;
    return this.records.read();
  }
}
