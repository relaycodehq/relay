/**
 * Runs jobs for the same key one after another, so two writes to a file or a
 * repository never overlap. A job that fails doesn't stop the next one.
 * `pending()` is what's still running or waiting, for flushing on exit.
 */
export function keyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  const run = async <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const before = tails.get(key);
    const task = (async () => {
      await before?.catch(() => {});
      return job();
    })();
    tails.set(key, task);
    try {
      return await task;
    } finally {
      if (tails.get(key) === task) tails.delete(key);
    }
  };
  return Object.assign(run, { pending: () => [...tails.values()] });
}
