import { useSyncExternalStore } from "react";

/**
 * A per-device preference kept in localStorage, like the theme. `parse` turns
 * what was saved (null when nothing was) into the value, and is the place to
 * reject anything malformed; `serialize` gives what to save, or null to clear.
 * `use` reads it in a component and `set` changes it for all of them.
 */
export function persistedStore<T>(
  key: string,
  parse: (saved: string | null) => T,
  serialize: (value: T) => string | null,
) {
  const listeners = new Set<() => void>();
  let current = (() => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  })();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const fallback = parse(null);
  return {
    get: () => current,
    subscribe,
    use: () =>
      useSyncExternalStore(
        subscribe,
        () => current,
        () => fallback,
      ),
    set(next: T) {
      current = next;
      try {
        const saved = serialize(next);
        if (saved === null) localStorage.removeItem(key);
        else localStorage.setItem(key, saved);
      } catch {
        // Still applies for this session.
      }
      for (const listener of listeners) listener();
    },
  };
}
