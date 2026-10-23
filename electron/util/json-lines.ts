import { appendFile, readFile } from "node:fs/promises";
import { keyedQueue } from "./keyed-queue";
import { writeFileAtomic } from "./atomic-write";

/** Serialized JSONL persistence. A crash-cut final record never consumes the next append. */
export class JsonLines<T> {
  private records?: T[];
  private cut = false;
  private queue = keyedQueue();

  constructor(private path: string) {}

  read(): Promise<readonly T[]> {
    return this.queue("file", () => this.load());
  }

  append(entry: T) {
    return this.queue("file", async () => {
      const records = await this.load();
      try {
        await appendFile(
          this.path,
          `${this.cut ? "\n" : ""}${JSON.stringify(entry)}\n`,
          { mode: 0o600 },
        );
      } catch (error) {
        // A failed append may itself have written a prefix. Inspect disk again
        // before another write instead of trusting its former line boundary.
        this.records = undefined;
        throw error;
      }
      this.cut = false;
      records.push(entry);
    });
  }

  /** Domain owners choose retention; rewriting cannot replace a good file with a partial one. */
  retain(keep: (entry: T) => boolean) {
    return this.queue("file", async () => {
      const records = await this.load();
      const kept = records.filter(keep);
      if (kept.length === records.length) return;
      await writeFileAtomic(
        this.path,
        kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
      );
      this.records = kept;
      this.cut = false;
    });
  }

  private async load() {
    if (this.records) return this.records;
    const text = await readFile(this.path, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return "";
      },
    );
    this.cut = text.length > 0 && !text.endsWith("\n");
    this.records = text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
    return this.records;
  }
}
