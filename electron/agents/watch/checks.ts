import { randomUUID } from "node:crypto";
import type { WatchNote, WatchTokens } from "../../../shared/watch";
import type { AgentWatch } from "../types";
import { parseNote, sameNote, saidInAnswer, type ParsedNote } from "./parse";

/** What one check cost, as its agent measured it; no `usd` without a list price. */
export type CheckCost = {
  model: string;
  tokens: WatchTokens;
  usd?: number;
  /** Taken out of totals the thread's own requests also moved. */
  split?: boolean;
};

/** Asks beside the live session; `reply` is null when it had no answer. */
export type WatchAsk = (
  question: string,
  signal: AbortSignal,
) => Promise<{ reply: string | null; cost?: CheckCost }>;

export type WatchCheck = {
  /** One of each waits at a time: "main", or a subagent's call id. */
  key: string;
  prompt: (shown: string[]) => string;
  /** The turn the note belongs to, and what it was told is known. */
  watch: AgentWatch;
  signal: AbortSignal;
  agent?: { id: string; label: string };
  onShown?: () => void;
  /** The answer the person is about to read; a point it makes isn't news. */
  answer?: string;
};

/**
 * A session's side checks, one at a time, with what they already showed so
 * the same point isn't made twice in the thread. Each check reports what it
 * spent when its agent could measure it.
 */
export class WatchChecks {
  private queue: WatchCheck[] = [];
  private running = false;
  private shown: string[] = [];

  constructor(private ask: WatchAsk) {}

  enqueue(check: WatchCheck) {
    if (check.signal.aborted) return;
    if (this.queue.some((c) => c.key === check.key)) return;
    this.queue.push(check);
    void this.drain();
  }

  /** Settles once nothing is running or waiting; for tests and scripts. */
  async idle() {
    while (this.running || this.queue.length)
      await new Promise((resolve) => setTimeout(resolve, 20));
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (let check; (check = this.queue.shift());) {
        if (check.signal.aborted) continue;
        const shown = [
          ...new Set([...(check.watch.shown ?? []), ...this.shown]),
        ];
        // Asked for at once: a subagent's digest counts as seen from here.
        const question = check.prompt(shown);
        const { reply, cost } = await this.ask(question, check.signal).catch(
          () => ({ reply: null, cost: undefined }),
        );
        const parsed = reply ? parseNote(reply) : null;
        const noted =
          !!parsed &&
          !saidInAnswer(parsed.said, check.answer ?? "") &&
          !this.seen(parsed, [
            ...shown,
            ...check.watch.known,
            ...(check.watch.topics ?? []),
          ]);
        if (noted) this.show(parsed, check);
        if (cost)
          check.watch.onSpend?.({
            kind: "check",
            about: check.agent ? "subagent" : "main",
            model: cost.model,
            tokens: cost.tokens,
            ...(cost.usd === undefined ? {} : { usd: cost.usd }),
            ...(cost.split ? { split: true as const } : {}),
            noted,
          });
      }
    } finally {
      this.running = false;
    }
  }

  /** Entries read "title: line", or a bare title from before they did. */
  private seen(note: ParsedNote, before: string[]) {
    return before.some((entry) => {
      const [title, ...rest] = entry.split(": ");
      const line = rest.join(": ");
      return [entry, title, line]
        .filter(Boolean)
        .some((t) => sameNote(t, note.line) || sameNote(t, note.title));
    });
  }

  private show(parsed: ParsedNote, check: WatchCheck) {
    this.shown.push(`${parsed.title}: ${parsed.line}`);
    const { said: _, ...shown } = parsed;
    const note: WatchNote = {
      id: randomUUID(),
      ...shown,
      ...(check.agent ? { agent: check.agent } : {}),
      created: Date.now(),
    };
    check.watch.onNote(note);
    check.onShown?.();
  }
}
