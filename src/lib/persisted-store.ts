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
 * One of `choices` kept per device under `key` as plain text, `fallback`
 * until one is picked or when what was saved isn't among them.
 */
export function useStoredChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return choices.find((choice) => choice === saved) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const choose = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Still applies until the screen closes.
    }
  };
  return [value, choose] as const;
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
  const read = () => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  };
  let current = read();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // A thread's own window shares storage, but has its own store and listeners.
  if (typeof window !== "undefined")
    window.addEventListener?.("storage", (event) => {
      if (
        event.storageArea !== localStorage ||
        (event.key !== null && event.key !== key)
      )
        return;
      current = read();
      notify();
    });
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
      notify();
    },
  };
}
