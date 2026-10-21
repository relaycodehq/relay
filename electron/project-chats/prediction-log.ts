import { JsonLines } from "../util/json-lines";
import { agentMention } from "../../shared/agents";
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
  private reading?: Promise<number>;
  private passes = 0;

  constructor(path: string) {
    this.records = new JsonLines(path);
  }

  /**
   * Whether a turn that earns a guess gets one. After a long run of guesses
   * nobody sent, only one turn in ten does, until one of them is sent.
   */
  allows(): boolean | Promise<boolean> {
    if (this.unused === undefined)
      return this.streak().then(
        () => this.allowed(),
        () => true,
      );
    return this.allowed();
  }

  private allowed() {
    if ((this.unused ?? 0) < UNUSED_STREAK) return true;
    return ++this.passes % BACKED_OFF_EVERY === 0;
  }

  asked(chatId: string, asked: PredictionAsked) {
    this.add({ kind: "asked", ...asked, at: Date.now(), chatId });
  }

  /** A message went out after `guess` was on screen; `body` as stored, with the composer's leading mention. */
  sent(chatId: string, guess: string, body: string) {
    const taken =
      (agentMention(body)?.question ?? body.trim()) === guess.trim();
    const count = () => {
      if (this.unused !== undefined) this.unused = taken ? 0 : this.unused + 1;
    };
    if (taken) this.passes = 0;
    // Before the log is read, counted once the read queued ahead of it is in.
    const late = this.unused === undefined;
    if (!late) count();
    this.add(
      { kind: "sent", taken, at: Date.now(), chatId },
      late ? count : undefined,
    );
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

  /** Read once from the log, in line with its writes, then kept as messages are sent. */
  private streak(): Promise<number> {
    if (this.unused !== undefined) return Promise.resolve(this.unused);
    if (!this.reading) {
      const reading = this.writing
        .then(() => this.load())
        .then((entries) => {
          let unused = 0;
          for (const e of entries)
            if (e.kind === "sent") unused = e.taken ? 0 : unused + 1;
          this.unused = unused;
          return unused;
        })
        .finally(() => {
          this.reading = undefined;
        });
      this.reading = reading;
      this.writing = reading.then(
        () => {},
        () => {},
      );
    }
    return this.reading;
  }

  private add(entry: Entry, written?: () => void) {
    // After the first load, which may rewrite the file without old entries.
    this.writing = this.writing
      .then(() => this.load())
      .then(() => this.records.append(entry))
      .then(written)
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
