import { useSyncExternalStore } from "react";

/**
 * An on/off preference kept per device in localStorage, like the theme, and
 * on until turned off. `use` reads it in a component; `set` changes it.
 */
export function localSwitch(key: string) {
  const listeners = new Set<() => void>();
  let on = (() => {
    try {
      return localStorage.getItem(key) !== "off";
    } catch {
      return true;
    }
  })();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    use: () =>
      useSyncExternalStore(
        subscribe,
        () => on,
        () => true,
      ),
    set(next: boolean) {
      on = next;
      try {
        localStorage.setItem(key, next ? "on" : "off");
      } catch {
        // Still applies for this session.
      }
      for (const listener of listeners) listener();
    },
  };
}
