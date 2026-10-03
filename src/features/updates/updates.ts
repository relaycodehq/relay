import { useSyncExternalStore } from "react";
import { api } from "../../lib/api";
import type { UpdateState } from "../../../shared/updates";

/** The updater's state, and the check asked for from Settings → About. */
export interface Updates {
  state?: UpdateState;
  /** A check asked for from About is under way. */
  checking: boolean;
  /** Why that check got no answer; the next update event clears it. */
  failure?: string;
  /** When that check last found a newer release. */
  foundAt?: number;
}

// A feed that answers at once would flash the check past; this long, it reads.
const shortestCheck = 1400;
const listeners = new Set<() => void>();
let updates: Updates = { checking: false };
let listening = false,
  asking = false;

function change(next: Partial<Updates>) {
  updates = { ...updates, ...next };
  for (const listener of listeners) listener();
}

/** Asks for the state until one arrives; each new subscriber asks again. */
function askState() {
  if (updates.state || asking) return;
  asking = true;
  api
    .updateState()
    // An event can overtake the first answer; the newer state wins.
    .then((state) => updates.state || change({ state }))
    .catch((e) => console.warn("Could not read the update state:", e))
    .finally(() => {
      asking = false;
    });
}

function subscribe(listener: () => void) {
  if (!listening) {
    listening = true;
    api.onUpdate((state) =>
      change(updates.checking ? { state } : { state, failure: undefined }),
    );
  }
  askState();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useUpdates = () => useSyncExternalStore(subscribe, () => updates);

/**
 * Looks for a newer release now, taking at least long enough to watch, and
 * downloads one it finds: asking was the go-ahead. The download belongs to the
 * main process, so closing Settings leaves it running in the sidebar.
 */
export async function checkForUpdates() {
  if (updates.checking) return;
  change({ checking: true, failure: undefined });
  const [check] = await Promise.allSettled([
    api.checkForUpdates(),
    new Promise((resolve) => setTimeout(resolve, shortestCheck)),
  ]);
  const found = check.status === "fulfilled" ? check.value : undefined;
  change({
    checking: false,
    ...(found?.status === "available" && { foundAt: Date.now() }),
    failure:
      check.status === "fulfilled"
        ? undefined
        : check.reason instanceof Error
          ? check.reason.message
          : "Couldn't check for updates.",
  });
  if (found?.status === "available" && found.install === "auto")
    void api.downloadUpdate();
}
