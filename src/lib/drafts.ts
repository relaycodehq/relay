import { useCallback, useSyncExternalStore } from "react";

// Chat drafts live outside React state so a keystroke re-renders only the
// composer that shows the draft, not the whole conversation around it.
const listeners = new Map<string, Set<() => void>>();

export function readDraft(key: string): string {
  return localStorage.getItem(key) ?? "";
}

export function writeDraft(key: string, value: string) {
  localStorage.setItem(key, value);
  listeners.get(key)?.forEach((notify) => notify());
}

export function useDraft(key: string): string {
  const subscribe = useCallback(
    (notify: () => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(notify);
      return () => {
        set.delete(notify);
        if (!set.size) listeners.delete(key);
      };
    },
    [key],
  );
  return useSyncExternalStore(subscribe, () => readDraft(key));
}
