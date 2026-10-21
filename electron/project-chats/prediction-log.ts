import { JsonLines } from "../util/json-lines";
import type {
  PredictionAsked,
  PredictionSummary,
} from "../../shared/prediction";

type Entry = { at: number; chatId: string } & (
  ({ kind: "asked" } & PredictionAsked) | { kind: "sent"; taken: boolean }
);

const DAY = 24 * 60 * 60_000;
/** Messages in a row sent past a guess before guessing backs off… */
const UNUSED_STREAK = 20;
/** …to one turn in this many, until a guess is sent again. */
const BACKED_OFF_EVERY = 10;
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
  /** Messages sent since one was a guess; unknown until the log is read. */
  private unused?: number;
  private passes = 0;

  constructor(path: string) {
    this.records = new JsonLines(path);
  }

  /**
   * Whether a turn that earns a guess gets one. After a long run of guesses
   * nobody sent, only one turn in ten does, until one of them is sent.
   */
  allows() {
    if (this.unused === undefined) void this.streak().catch(() => {});
    if ((this.unused ?? 0) < UNUSED_STREAK) return true;
    return ++this.passes % BACKED_OFF_EVERY === 0;
  }

  asked(chatId: string, asked: PredictionAsked) {
    this.add({ kind: "asked", ...asked, at: Date.now(), chatId });
  }

  /** A message went out while `guess` was on offer. */
  sent(chatId: string, guess: string, body: string) {
    const taken = body.trim() === guess.trim();
    if (this.unused !== undefined) this.unused = taken ? 0 : this.unused + 1;
    if (taken) this.passes = 0;
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
    summary.backingOff = (await this.streak()) >= UNUSED_STREAK;
    return summary;
  }

  /** Read once from the log, then kept as messages are sent. */
  private async streak() {
    await this.writing;
    if (this.unused !== undefined) return this.unused;
    let unused = 0;
    for (const e of await this.load())
      if (e.kind === "sent") unused = e.taken ? 0 : unused + 1;
    this.unused ??= unused;
    return this.unused;
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
