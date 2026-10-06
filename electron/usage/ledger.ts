import { appendFile, readFile } from "node:fs/promises";
import type { UsageEntry } from "../../shared/usage";

/**
 * What the agents used, one JSON line per run, kept on this computer for the
 * Usage page. Nothing here leaves it. A line is a few hundred bytes, so a
 * busy year stays in the low megabytes and nothing is ever pruned.
 */
export class UsageLedger {
  private entries?: Promise<UsageEntry[]>;
  private writing = Promise.resolve();
  /** The file ends in a line a crash cut short, so the next one starts fresh. */
  private cut = false;

  constructor(private path: string) {}

  add(entry: UsageEntry) {
    this.writing = this.writing
      .then(() => this.load())
      .then((all) => {
        all.push(entry);
        const line = `${this.cut ? "\n" : ""}${JSON.stringify(entry)}\n`;
        this.cut = false;
        return appendFile(this.path, line);
      })
      .catch((e) => console.warn("Could not log what an agent used:", e));
  }

  /** Every entry, after the ones still being written. */
  async all(): Promise<readonly UsageEntry[]> {
    await this.writing;
    return this.load();
  }

  private load() {
    this.entries ??= readFile(this.path, "utf8")
      .then((text) => {
        this.cut = text.length > 0 && !text.endsWith("\n");
        return text
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as UsageEntry];
            } catch {
              // A line cut short by a crash; the rest still count.
              return [];
            }
          });
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT")
          console.warn("Could not read the usage log:", error);
        return [];
      });
    return this.entries;
  }
}
