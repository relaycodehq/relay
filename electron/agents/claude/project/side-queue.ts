/**
 * A session's side questions, one at a time: they share its meter, and two
 * at once would each count the other's requests as their own.
 */
export class SideQueue {
  private running = false;
  private waiting: { start: () => void }[] = [];

  /**
   * Runs `work` once the ones before it are done. Cancelled while it waits,
   * it leaves the line and the rest keep waiting for the one running.
   * `holdMs` frees the line after that long even if `work` hangs.
   */
  run<T>(
    work: () => Promise<T>,
    signal: AbortSignal,
    options: { holdMs?: number } = {},
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const entry = {
        start: () => {
          signal.removeEventListener("abort", cancel);
          this.running = true;
          let freed = false;
          const free = () => {
            if (freed) return;
            freed = true;
            clearTimeout(hold);
            this.next();
          };
          const hold =
            options.holdMs === undefined
              ? undefined
              : setTimeout(free, options.holdMs);
          const done = (async () => work())();
          done.then(resolve, reject);
          done.then(free, free);
        },
      };
      const cancel = () => {
        this.waiting = this.waiting.filter((e) => e !== entry);
        reject(signal.reason);
      };
      if (!this.running) return entry.start();
      signal.addEventListener("abort", cancel, { once: true });
      this.waiting.push(entry);
    });
  }

  private next() {
    this.running = false;
    this.waiting.shift()?.start();
  }
}
