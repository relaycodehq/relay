import { useSyncExternalStore } from "react";
import type { ReadAloudState } from "../../../shared/read-aloud";
import { api } from "../../lib/api";

// Engines, downloads and settings, as the main process reports them.
let state: ReadAloudState | undefined;
const listeners = new Set<() => void>();
let watched = false;

function watch() {
  // A window whose main process predates read aloud (reloaded, not restarted).
  if (watched || !window.relay || typeof api.onReadAloudState !== "function")
    return;
  watched = true;
  const update = (next: ReadAloudState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  api.onReadAloudState(update);
  void api.readAloudState().then(update, () => {});
}

/** Undefined until the main process answers, or where it can't read aloud. */
export function useReadAloudState() {
  watch();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
