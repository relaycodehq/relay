// When the phone last reached each paired computer, so pairings that share a
// name can be told apart and a dead one spotted. Kept out of the keystore:
// it isn't secret and changes on every connection.
import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const key = "relay-computers-seen";

let seen: Record<string, number> = {};
const listeners = new Set<() => void>();
const changed = () => {
  seen = { ...seen };
  listeners.forEach((l) => l());
  void AsyncStorage.setItem(key, JSON.stringify(seen)).catch(() => {});
};

void AsyncStorage.getItem(key)
  .then((saved) => {
    if (!saved) return;
    // One reached while the read went on is newer than the saved time.
    seen = { ...JSON.parse(saved), ...seen };
    listeners.forEach((l) => l());
  })
  .catch(() => {});

export function reachedComputer(id: string) {
  seen[id] = Date.now();
  changed();
}

export function forgetComputerSeen(id: string) {
  if (!(id in seen)) return;
  delete seen[id];
  changed();
}

/** When the phone last reached each computer, by id; one never reached since this was kept is missing. */
export const useComputersSeen = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => seen,
  );
