import { randomUUID } from "node:crypto";
import type { WatchNote } from "../../../../shared/watch";
import type { AgentWatch } from "../../types";
import { parseNote, sameNote, type ParsedNote } from "./parse";

/** Asks beside the live session; null when it had no answer. */
export type WatchAsk = (
  question: string,
  signal: AbortSignal,
) => Promise<string | null>;

export type WatchCheck = {
  /** One of each waits at a time: "main", or a subagent's call id. */
  key: string;
  prompt: (shown: string[]) => string;
  /** The turn the note belongs to, and what it was told is known. */
  watch: AgentWatch;
  signal: AbortSignal;
  agent?: { id: string; label: string };
  onShown?: () => void;
};

/**
 * A session's side checks, one at a time, with what they already showed so
 * the same point isn't made twice in the thread.
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
        const reply = await this.ask(
          check.prompt(this.shown),
          check.signal,
        ).catch(() => null);
        const parsed = reply ? parseNote(reply) : null;
        if (parsed && !this.seen(parsed, check.watch.known))
          this.show(parsed, check);
      }
    } finally {
      this.running = false;
    }
  }

  private seen(note: ParsedNote, known: string[]) {
    return [...this.shown, ...known].some(
      (line) => sameNote(line, note.line) || sameNote(line, note.title),
    );
  }

  private show(parsed: ParsedNote, check: WatchCheck) {
    this.shown.push(parsed.line);
    const note: WatchNote = {
      id: randomUUID(),
      ...parsed,
      ...(check.agent ? { agent: check.agent } : {}),
      created: Date.now(),
    };
    check.watch.onNote(note);
    check.onShown?.();
  }
}
