// The phone looks up the newest Relay app in the public release feed itself,
// so it updates whatever its desktop runs, and with no desktop at all. The
// desktop's offer (self-update.ts) still comes first when it's newer.
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { fetchNewestApp, offersNewer, type NewestApp } from "../../../shared/phone-release";
import { onMeteredNetwork, prefetchApk } from "./apk-install";
import { runningVersion } from "./self-update";

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
export const releaseBuild = !!Constants.expoConfig?.extra?.relayRuntime;

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

const loaded = AsyncStorage.getItem(key)
  .then((saved) => {
    if (!saved) return;
    const { newest, checkedAt } = JSON.parse(saved) as Pick<LatestApp, "newest" | "checkedAt">;
    set({ ...state, newest, checkedAt });
  })
  .catch(() => {});
let triedAt = 0;

/** The feed's app when this one should move to it. */
export const latestOffer = (latest: LatestApp): NewestApp | undefined =>
  offersNewer(latest.newest, { apk: installedApp, running: runningVersion })
    ? latest.newest
    : undefined;

/** Looks at the release feed when the last look is old enough, or now with `force`. */
export async function checkLatestApp(force = false) {
  if (!checksLatestApp) return;
  await loaded;
  const now = Date.now();
  if (state.checking) return;
  if (!force && (now - (state.checkedAt ?? 0) < everyMs || now - triedAt < retryMs)) return;
  triedAt = now;
  set({ ...state, checking: true, error: undefined });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const newest = await fetchNewestApp(fetch, { signal: abort.signal });
    set({ newest, checkedAt: Date.now(), checking: false });
    void AsyncStorage.setItem(key, JSON.stringify({ newest, checkedAt: state.checkedAt }));
  } catch (e) {
    const message = abort.signal.aborted
      ? "GitHub didn't answer."
      : e instanceof Error
        ? e.message
        : String(e);
    set({ ...state, checking: false, error: message });
    return;
  } finally {
    clearTimeout(timer);
  }
  const offer = latestOffer(state);
  // Only on Wi-Fi and the like: the APK is tens of MB, and Android asks before installing anyway.
  if (offer && releaseBuild && onMeteredNetwork() === false) prefetchApk(offer);
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
