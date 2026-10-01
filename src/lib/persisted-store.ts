import { useEffect, useState, useSyncExternalStore } from "react";

/** What `key` holds, parsed; undefined when it's unset, malformed or storage is unavailable. */
export function readJson(key: string): unknown {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? undefined : JSON.parse(saved);
  } catch {
    return undefined;
  }
}

/** Saves `value` under `key` as JSON; storage that's unavailable or full is no error. */
export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // What's kept this way is a convenience; it never blocks the workspace.
  }
}

/**
 * Component state kept per device under `key`, saved as it changes. `parse`
 * turns what was saved (undefined when nothing or malformed) into the state.
 */
export function useStoredState<T>(key: string, parse: (saved: unknown) => T) {
  const [value, setValue] = useState(() => parse(readJson(key)));
  useEffect(() => writeJson(key, value), [value]);
  return [value, setValue] as const;
}

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
