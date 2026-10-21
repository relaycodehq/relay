import { JsonLines } from "../util/json-lines";
import type {
  PredictionAsked,
  PredictionSummary,
} from "../../shared/prediction";

type Entry = { at: number; chatId: string } & (
  ({ kind: "asked" } & PredictionAsked) | { kind: "sent"; taken: boolean }
);

const DAY = 24 * 60 * 60_000;
/** Older entries go at the next start; Settings looks back a week. */
const KEEP_DAYS = 30;

/**
 * The composer's guesses at the next message, one JSON line per guess asked
 * for and per message sent while one was on offer, so Settings can weigh
 * what they cost against how often they were what got sent.
 */
export class PredictionLog {
  private initialized?: Promise<void>;
  private records: JsonLines<Entry>;
  private writing = Promise.resolve();

  constructor(path: string) {
    this.records = new JsonLines(path);
  }

  asked(chatId: string, asked: PredictionAsked) {
    this.add({ kind: "asked", ...asked, at: Date.now(), chatId });
  }

  /** A message went out while `guess` was on offer. */
  sent(chatId: string, guess: string, body: string) {
    const taken = body.trim() === guess.trim();
    this.add({ kind: "sent", taken, at: Date.now(), chatId });
  }

  async summary(
    days: number,
    /** What these threads' own turns spent since `since`. */
    threadUsd: (chats: Set<string>, since: number) => Promise<number>,
  ): Promise<PredictionSummary> {
    await this.writing;
    const since = Date.now() - days * DAY;
    const recent = (await this.load()).filter((e) => e.at >= since);
    const summary: PredictionSummary = {
      days,
      asked: 0,
      offered: 0,
      sentAfter: 0,
      taken: 0,
      usd: 0,
      unmeasured: 0,
      threadUsd: 0,
    };
    const chats = new Set<string>();
    for (const e of recent) {
      if (e.kind === "sent") {
        summary.sentAfter++;
        if (e.taken) summary.taken++;
        continue;
      }
      chats.add(e.chatId);
      summary.asked++;
      if (e.offered) summary.offered++;
      if (e.cost?.usd === undefined) summary.unmeasured++;
      else summary.usd += e.cost.usd;
    }
    if (chats.size) summary.threadUsd = await threadUsd(chats, since);
    return summary;
  }

  private add(entry: Entry) {
    // After the first load, which may rewrite the file without old entries.
    this.writing = this.writing
      .then(() => this.load())
      .then(() => this.records.append(entry))
      .catch((e) => console.warn("Could not log a next-message guess:", e));
  }

  private async load() {
    this.initialized ??= this.records
      .retain((entry) => entry.at >= Date.now() - KEEP_DAYS * DAY)
      .catch((error) => {
        this.initialized = undefined;
        throw error;
      });
    await this.initialized;
    return this.records.read();
  }
}
