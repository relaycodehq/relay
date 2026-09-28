import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { UpdateState } from "../../shared/updates";

/** The updater's state, and the check asked for from Settings → About. */
export interface Updates {
  state?: UpdateState;
  /** A check asked for from About is under way. */
  checking: boolean;
  /** Why that check got no answer; the next update event clears it. */
  failure?: string;
}

// A feed that answers at once would flash the check past; this long, it reads.
const shortestCheck = 1400;
const listeners = new Set<() => void>();
let updates: Updates = { checking: false };
let listening = false;

function change(next: Partial<Updates>) {
  updates = { ...updates, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (!listening) {
    listening = true;
    // An event can overtake the first answer; the newer state wins.
    void api.updateState().then((state) => updates.state || change({ state }));
    api.onUpdate((state) =>
      change(updates.checking ? { state } : { state, failure: undefined }),
    );
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useUpdates = () => useSyncExternalStore(subscribe, () => updates);

/** Looks for a newer release now, taking at least long enough to watch. */
export async function checkForUpdates() {
  if (updates.checking) return;
  change({ checking: true, failure: undefined });
  const [check] = await Promise.allSettled([
    api.checkForUpdates(),
    new Promise((resolve) => setTimeout(resolve, shortestCheck)),
  ]);
  change({
    checking: false,
    failure:
      check.status === "fulfilled"
        ? undefined
        : check.reason instanceof Error
          ? check.reason.message
          : "Couldn't check for updates.",
  });
}
