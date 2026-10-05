import type { AgentWatch } from "../types";
import type { WatchChecks } from "./checks";
import { threadCheckPrompt, type SubagentRun } from "./prompt";

/** Main-agent calls a turn needs before it's worth a look back. */
const MIN_CALLS = 3;

/**
 * Watches one turn: once its answer is in, if it did any real work, one
 * look back over it asks whether there's something the person would miss.
 * Measured on real threads, checking every few calls instead cost three
 * times as much and mostly flagged work still in progress.
 */
export class TurnWatcher {
  private calls = new Set<string>();
  private done = false;

  constructor(
    private watch: AgentWatch,
    private queue: WatchChecks,
    private signal: AbortSignal,
    /** Subagents that changed files since the last look; taken once. */
    private subagents?: () => SubagentRun[],
  ) {}

  /** The main agent made these calls; repeats of an id count once. */
  called(ids: string[]) {
    for (const id of ids) this.calls.add(id);
  }

  /** The turn finished with `answer`. */
  ended(answer = "") {
    if (this.done || this.signal.aborted) return;
    this.done = true;
    const runs = this.subagents?.() ?? [];
    if (this.calls.size < MIN_CALLS && !runs.length) return;
    this.queue.enqueue({
      key: "main",
      prompt: (shown) =>
        threadCheckPrompt({
          shown,
          topics: this.watch.topics ?? [],
          subagents: runs,
        }),
      watch: this.watch,
      signal: this.signal,
      answer,
    });
  }
}
