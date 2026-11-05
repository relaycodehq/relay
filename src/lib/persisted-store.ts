import { useEffect, useState, useSyncExternalStore } from "react";

/** What `key` holds as text; null when it's unset or storage is unavailable. */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves `value` under `key` as is, or clears it on null; storage that's unavailable or full is no error. */
export function writeText(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // What's kept this way is a convenience; it never blocks the workspace.
  }
}

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
    const saved = readText(key);
    return choices.find((choice) => choice === saved) ?? fallback;
  });
  const choose = (next: T) => {
    setValue(next);
    writeText(key, next);
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
  const parsed = (text: string | null) => {
    try {
      return parse(text);
    } catch {
      return parse(null);
    }
  };
  let saved = readText(key);
  let current = parsed(saved);
  // Picks up what another window saved; the same text keeps the same value.
  const refresh = () => {
    const text = readText(key);
    if (text === saved) return false;
    saved = text;
    current = parsed(text);
    return true;
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // A thread's own window shares storage, but has its own store and listeners.
  const heard = (event: StorageEvent) => {
    if (
      event.storageArea !== localStorage ||
      (event.key !== null && event.key !== key)
    )
      return;
    if (refresh()) notify();
  };
  const inWindow = typeof window !== "undefined";
  // Heard only while something follows it: stores made per thread would
  // otherwise leave a window listener behind for every thread opened.
  const subscribe = (listener: () => void) => {
    if (!listeners.size && inWindow) {
      refresh();
      window.addEventListener?.("storage", heard);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && inWindow)
        window.removeEventListener?.("storage", heard);
    };
  };
  const fallback = parse(null);
  return {
    get() {
      if (!listeners.size) refresh();
      return current;
    },
    subscribe,
    use: () =>
      useSyncExternalStore(
        subscribe,
        () => current,
        () => fallback,
      ),
    set(next: T) {
      current = next;
      writeText(key, serialize(next));
      saved = readText(key);
      notify();
    },
  };
}
