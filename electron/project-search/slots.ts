/**
 * The search each slot is running. Starting another in a slot stops the
 * first, so typing never leaves the old query's results racing the new one's.
 */
export class SearchSlots {
  private running = new Map<string, AbortController>();

  /** The signal for a new search in `key`, the previous one's cancelled. */
  start(key: string) {
    this.running.get(key)?.abort();
    const controller = new AbortController();
    this.running.set(key, controller);
    return controller.signal;
  }

  /** The search ended; its slot is free unless a newer search took it. */
  finish(key: string, signal: AbortSignal) {
    if (this.running.get(key)?.signal === signal) this.running.delete(key);
  }

  cancel(key: string) {
    this.running.get(key)?.abort();
    this.running.delete(key);
  }
}
