/**
 * Values by key, forgetting the least recently used once their size passes
 * `budget`. The size of an entry is its key's length unless `sizeOf` says
 * otherwise, so a cache keyed by text grows with the text it holds.
 */
export class SizedCache<V> {
  private readonly entries = new Map<string, V>();
  private size = 0;

  constructor(
    private readonly budget: number,
    private readonly sizeOf: (key: string, value: V) => number = (key) =>
      key.length,
  ) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Most recently used last, so it goes last.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V) {
    const old = this.entries.get(key);
    if (old !== undefined) {
      this.entries.delete(key);
      this.size -= this.sizeOf(key, old);
    }
    this.entries.set(key, value);
    this.size += this.sizeOf(key, value);
    for (const [oldest, gone] of this.entries) {
      if (this.size <= this.budget) break;
      this.entries.delete(oldest);
      this.size -= this.sizeOf(oldest, gone);
    }
  }
}
