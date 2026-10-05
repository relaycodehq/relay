import type { AgentWatch } from "../types";
import type { WatchChecks } from "./checks";
import { threadCheckPrompt } from "./prompt";

/** Main-agent calls between checks of the thread. */
const MAIN_EVERY = 6;
/** Checks of the thread one turn may run, so a very long turn can't keep paying for them. */
const MAX_CHECKS = 12;

/**
 * Watches one Claude turn's main thread: every few main-agent calls it asks,
 * beside the session, whether there's something the person would miss.
 * Subagents are watched for the whole session instead; see SubagentWatch.
 */
export class TurnWatcher {
  private calls = new Set<string>();
  private checkedAt = 0;
  private every = MAIN_EVERY;
  private checks = 0;

  constructor(
    private watch: AgentWatch,
    private queue: WatchChecks,
    private signal: AbortSignal,
  ) {}

  /** The main agent made these calls; repeats of an id count once. */
  called(ids: string[]) {
    for (const id of ids) this.calls.add(id);
    if (this.calls.size - this.checkedAt < this.every) return;
    if (this.checks >= MAX_CHECKS) return;
    this.checkedAt = this.calls.size;
    this.checks++;
    this.queue.enqueue({
      key: "main",
      prompt: (shown) => threadCheckPrompt({ shown, known: this.watch.known }),
      watch: this.watch,
      signal: this.signal,
      // Something worth saying makes the next look wait longer.
      onShown: () => {
        this.every *= 2;
      },
    });
  }
}
