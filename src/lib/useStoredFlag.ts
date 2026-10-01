import { useCallback } from "react";
import { persistedStore } from "./persisted-store";

type Flag = ReturnType<typeof persistedStore<boolean | null>>;
// One store per key, so every component showing a flag follows its changes.
const flags = new Map<string, Flag>();
function flag(key: string): Flag {
  let store = flags.get(key);
  if (!store) {
    store = persistedStore<boolean | null>(
      key,
      (saved) => (saved === null ? null : saved === "true"),
      (on) => (on === null ? null : String(on)),
    );
    flags.set(key, store);
  }
  return store;
}

/** A boolean kept per device in localStorage; `fallback` until it's first set. */
export function useStoredFlag(key: string, fallback = false) {
  const store = flag(key);
  const on = store.use() ?? fallback;
  const setOn = useCallback(
    (next: boolean | ((on: boolean) => boolean)) =>
      store.set(
        typeof next === "function" ? next(store.get() ?? fallback) : next,
      ),
    [store, fallback],
  );
  return [on, setOn] as const;
}
