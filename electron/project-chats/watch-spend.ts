import { appendFile, readFile, writeFile } from "node:fs/promises";
import type {
  WatchSpend,
  WatchSpendSummary,
  WatchSpendThread,
} from "../../shared/watch";

type Entry = WatchSpend & { at: number; chatId: string };

const DAY = 24 * 60 * 60_000;
/** Older entries go at the next start; Settings looks back a week. */
const KEEP_DAYS = 30;

/**
 * What "Flag what I'd miss" spent, one JSON line per check or watched turn,
 * so Settings can say what it costs next to what the threads cost.
 */
export class WatchSpendLog {
  private entries?: Promise<Entry[]>;
  private writing = Promise.resolve();

  constructor(private path: string) {}

  add(chatId: string, spend: WatchSpend) {
    const entry: Entry = { ...spend, at: Date.now(), chatId };
    // After the first load, which may rewrite the file without old entries.
    this.writing = this.writing
      .then(() => this.load())
      .then((all) => {
        all.push(entry);
        return appendFile(this.path, `${JSON.stringify(entry)}\n`);
      })
      .catch((e) => console.warn("Could not log what a side check spent:", e));
  }

  async summary(
    days: number,
    titleOf: (chatId: string) => string | undefined,
  ): Promise<WatchSpendSummary> {
    const since = Date.now() - days * DAY;
    const recent = (await this.load()).filter((e) => e.at >= since);
    const threads = new Map<string, WatchSpendThread>();
    for (const e of recent) {
      let t = threads.get(e.chatId);
      if (!t) {
        t = {
          chatId: e.chatId,
          title: titleOf(e.chatId) ?? "Deleted thread",
          checks: 0,
          notes: 0,
          usd: 0,
          threadUsd: 0,
          tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
          split: 0,
          subagentChecks: 0,
          unpriced: 0,
        };
        threads.set(e.chatId, t);
      }
      if (e.kind === "thread") {
        t.threadUsd += e.usd;
        continue;
      }
      t.checks++;
      if (e.usd === undefined) t.unpriced++;
      else t.usd += e.usd;
      if (e.noted) t.notes++;
      if (e.split) t.split++;
      if (e.about === "subagent") t.subagentChecks++;
      t.tokens.input += e.tokens.input;
      t.tokens.cacheWrite += e.tokens.cacheWrite;
      t.tokens.cacheRead += e.tokens.cacheRead;
      t.tokens.output += e.tokens.output;
    }
    const list = [...threads.values()]
      .filter((t) => t.checks)
      .sort((a, b) => b.usd - a.usd);
    const sum = (pick: (t: WatchSpendThread) => number) =>
      list.reduce((total, t) => total + pick(t), 0);
    return {
      days,
      checks: sum((t) => t.checks),
      notes: sum((t) => t.notes),
      usd: sum((t) => t.usd),
      threadUsd: sum((t) => t.threadUsd),
      threads: list,
    };
  }

  private load() {
    this.entries ??= readFile(this.path, "utf8")
      .then(async (text) => {
        const since = Date.now() - KEEP_DAYS * DAY;
        const lines = text.split("\n").filter(Boolean);
        const kept = lines.flatMap((line) => {
          try {
            const entry = JSON.parse(line) as Entry;
            return entry.at >= since ? [entry] : [];
          } catch {
            return [];
          }
        });
        if (kept.length < lines.length)
          await writeFile(
            this.path,
            kept.map((e) => `${JSON.stringify(e)}\n`).join(""),
          );
        return kept;
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT")
          console.warn("Could not read what side checks spent:", error);
        return [];
      });
    return this.entries;
  }
}
