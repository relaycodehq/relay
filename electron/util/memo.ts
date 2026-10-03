/**
 * `load`'s answer for each key, kept for `ttl` ms. A failure isn't kept, so the
 * next caller asks again. Past `max` keys the oldest one is dropped.
 */
export function memoByKey<T>(
  load: (key: string) => Promise<T>,
  { ttl = 60000, max = 30 } = {},
) {
  const cache = new Map<string, { expires: number; result: Promise<T> }>();
  const get = (key: string) => {
    const previous = cache.get(key);
    if (previous && previous.expires > Date.now()) return previous.result;
    const entry = { expires: Date.now() + ttl, result: load(key) };
    // A failure forgets only its own answer, not one asked for since.
    entry.result.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    if (cache.size >= max) cache.delete(cache.keys().next().value!);
    cache.set(key, entry);
    return entry.result;
  };
  return Object.assign(get, { clear: () => cache.clear() });
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

/**
 * `load`'s answer, kept while `stamp` says the same, e.g. the installed CLI
 * that answered. A failure isn't kept; a stamp that fails asks again.
 */
export function memoWhileStamp<T>(
  stamp: () => Promise<string>,
  load: () => Promise<T>,
) {
  let kept: { stamp: string; result: Promise<T> } | undefined;
  return async () => {
    const now = await stamp().catch(() => undefined);
    if (now !== undefined && kept?.stamp === now) return kept.result;
    const result = load();
    const entry = now === undefined ? undefined : { stamp: now, result };
    kept = entry;
    result.catch(() => {
      if (entry && kept === entry) kept = undefined;
    });
    return result;
  };
}
