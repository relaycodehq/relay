/**
 * `load`'s answer for each key, kept for `ttl` ms. A failure isn't kept, so the
 * next caller asks again. Past `max` keys the oldest one is dropped.
 */
export function memoByKey<T>(
  load: (key: string) => Promise<T>,
  { ttl = 60000, max = 30 } = {},
) {
  const cache = new Map<string, { expires: number; result: Promise<T> }>();
  return (key: string) => {
    const previous = cache.get(key);
    if (previous && previous.expires > Date.now()) return previous.result;
    const result = load(key).catch((e) => {
      cache.delete(key);
      throw e;
    });
    if (cache.size >= max) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + ttl, result });
    return result;
  };
}

/** Like `memoByKey` for one answer; `forget()` drops it, e.g. after signing in as someone else. */
export function memoOnce<T>(load: () => Promise<T>, ttl = 60000) {
  let kept: { at: number; result: Promise<T> } | undefined;
  const get = () => {
    if (kept && Date.now() - kept.at < ttl) return kept.result;
    const result = load();
    kept = { at: Date.now(), result };
    result.catch(() => {
      if (kept?.result === result) kept = undefined;
    });
    return result;
  };
  get.forget = () => {
    kept = undefined;
  };
  return get;
}
