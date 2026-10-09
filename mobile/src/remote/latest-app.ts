// The phone looks up the newest Relay app in the public release feed itself,
// so it updates whatever its desktop runs, and with no desktop at all. The
// desktop's offer (self-update.ts) still comes first when it's newer.
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { z } from "zod";
import {
  fetchNewestApp,
  newestAppSchema,
  offersNewer,
  type NewestApp,
} from "../../../shared/phone-release";
import { onMeteredNetwork, prefetchApk } from "./apk-install";
import { pendingVersion } from "./self-update";
import { newerVersion } from "../../../shared/phone-app";

export interface LatestApp {
  newest?: NewestApp;
  checkedAt?: number;
  checking: boolean;
  error?: string;
}

/** Android only: iOS apps can't install anything themselves. */
export const checksLatestApp = Platform.OS === "android";
/** The version the installed APK carries; what a new APK replaces. */
export const installedApp = Constants.expoConfig?.version ?? "0.0.0";
/** Release builds only: development builds and Expo Go can't take the release APK. */
export const releaseBuild =
  !__DEV__ &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
  !!Constants.expoConfig?.extra?.relayRuntime;

const key = "relay.latestApp";
/** Between looks on their own; Check in Settings goes any time. */
const everyMs = 6 * 60 * 60_000;
/** After a failed look, so a phone without network doesn't ask on every return to the app. */
const retryMs = 10 * 60_000;
const timeoutMs = 20_000;

let state: LatestApp = { checking: false };
const listeners = new Set<() => void>();
const set = (next: LatestApp) => {
  state = next;
  for (const listener of listeners) listener();
};

let triedAt = 0;
const cacheSchema = z.object({
  newest: newestAppSchema.optional(),
  checkedAt: z.number().nonnegative().optional(),
  triedAt: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
const persist = () =>
  AsyncStorage.setItem(
    key,
    JSON.stringify({
      newest: state.newest,
      checkedAt: state.checkedAt,
      triedAt,
      error: state.error,
    }),
  ).catch((e) => console.warn("Couldn't save the app update check:", e));
const loaded = AsyncStorage.getItem(key)
  .then((saved) => {
    if (!saved) return;
    const savedState = cacheSchema.parse(JSON.parse(saved));
    triedAt = savedState.triedAt ?? 0;
    set({
      ...state,
      newest: savedState.newest,
      checkedAt: savedState.checkedAt,
      error: savedState.error,
    });
  })
  .catch(() => {});

/** The feed's app when this one should move to it. */
export const latestOffer = (latest: LatestApp): NewestApp | undefined =>
  offersNewer(latest.newest, {
    apk: installedApp,
    running: pendingVersion(),
  })
    ? latest.newest
    : undefined;

function prefetchLatestApp() {
  const offer = latestOffer(state);
  if (offer && releaseBuild && onMeteredNetwork() === false) prefetchApk(offer);
}

/** Looks at the release feed when the last look is old enough, or now with `force`. */
export async function checkLatestApp(force = false) {
  if (!checksLatestApp) return;
  await loaded;
  const now = Date.now();
  if (state.checking) return;
  if (
    !force &&
    (state.error
      ? now - triedAt < retryMs
      : now - (state.checkedAt ?? 0) < everyMs)
  ) {
    prefetchLatestApp();
    return;
  }
  triedAt = now;
  set({ ...state, checking: true, error: undefined });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const newest = await fetchNewestApp((url) =>
      fetch(url, { signal: abort.signal }),
    );
    // Older feeds infer the APK's version from the release; only an Android entry pins it.
    if (state.newest && (
      newerVersion(state.newest.release, newest.release) ||
      (state.newest.sha512 && newerVersion(state.newest.version, newest.version))
    )) throw new Error("The release feed went back to an older release or app.");
    set({ newest, checkedAt: Date.now(), checking: false });
    await persist();
  } catch (e) {
    const message = abort.signal.aborted
      ? "GitHub didn't answer."
      : e instanceof Error
        ? e.message
        : String(e);
    set({ ...state, checking: false, error: message });
    await persist();
    return;
  } finally {
    clearTimeout(timer);
  }
  prefetchLatestApp();
}

/** Looks at start and whenever the app comes back to the front, at most every few hours. */
export function useLatestAppChecks() {
  useEffect(() => {
    if (!checksLatestApp) return;
    void checkLatestApp();
    const sub = AppState.addEventListener("change", (now) => {
      if (now === "active") void checkLatestApp();
    });
    return () => sub.remove();
  }, []);
}

export function useLatestApp() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
