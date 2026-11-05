/**
 * Runs `work` on every item, at most `limit` at a time, so a thousand files
 * don't start a thousand processes at once. Stops taking new items after the
 * first failure, which it rethrows.
 */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<unknown>,
) {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      await work(item).catch((error: unknown) => {
        failed = true;
        throw error;
      });
    }
  };
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, worker));
}
