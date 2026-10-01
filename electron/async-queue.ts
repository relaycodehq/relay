/**
 * Items one side pushes and another reads in order, waiting while there are
 * none. Once it ends, reads stop waiting but still get what's queued, even
 * an item put back after; once it closes, they get nothing more.
 */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiting = new Set<() => void>();
  private closed = false;
  ended = false;

  push(item: T) {
    if (this.closed) return;
    this.items.push(item);
    this.wake();
  }

  end() {
    this.ended = true;
    this.wake();
  }

  close() {
    this.closed = true;
    this.items.length = 0;
    this.end();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  /** Everything queued, at once. */
  take(): T[] {
    return this.items.splice(0);
  }

  /** The next item, or undefined once the queue has ended and is empty. */
  async next(): Promise<T | undefined> {
    while (!this.items.length && !this.ended) await this.until();
    return this.items.shift();
  }

  /** Whether an item is queued within `ms`; false at once when it ended empty. */
  async wait(ms: number) {
    if (!this.items.length && !this.ended) await this.until(ms);
    return this.items.length > 0;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void> {
    let item: T | undefined;
    while ((item = await this.next()) !== undefined) yield item;
  }

  private until(ms?: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve();
      };
      const timer = ms === undefined ? undefined : setTimeout(done, ms);
      this.waiting.add(done);
    });
  }

  private wake() {
    for (const done of [...this.waiting]) done();
  }
}
