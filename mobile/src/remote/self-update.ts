// The app updates itself from the paired desktop: each desktop release
// carries the phone's code (electron/remote/phone-app.ts), and it arrives over
// the same encrypted link as everything else, so only the computer this phone
// paired with can hand it any. Native changes still need a new APK.
import { useSyncExternalStore } from "react";
import Constants from "expo-constants";
import { reloadAppAsync, requireOptionalNativeModule } from "expo";
import { phoneAppChunk, type PhoneAppRelease } from "../../../shared/remote";
import { releasesRepo } from "../../../shared/updates";
import { newerVersion, type PhoneAppReport } from "../../../shared/phone-app";

/** modules/relay-bundle; missing in Expo Go and development builds. */
interface RelayBundle {
  running: string | null;
  failed: string | null;
  confirm(): void;
  begin(): Promise<void>;
  append(path: string, base64: string): Promise<void>;
  commit(version: string, files: { path: string; sha256: string }[]): Promise<void>;
  clear(): Promise<void>;
}
const native = requireOptionalNativeModule<RelayBundle>("RelayBundle");

/** The version whose code is running: the desktop's last update, or the APK's own. */
export const runningVersion = native?.running ?? Constants.expoConfig?.version ?? "0.0.0";
/** Running code the desktop sent, rather than what the APK came with. */
export const runningUpdate = !!native?.running;
const runtime = Constants.expoConfig?.extra?.relayRuntime as string | undefined;

export type SelfUpdate =
  | { kind: "none" }
  | { kind: "downloading"; version: string; done: number }
  | { kind: "ready"; version: string }
  /** The desktop's version needs native changes this APK lacks. */
  | { kind: "apk"; version: string; url: string };

let state: SelfUpdate = { kind: "none" };
/** Installing an APK drops the staged bundle too; don't offer older code than that. */
export const pendingVersion = () =>
  state.kind === "ready" || state.kind === "downloading" ? state.version : runningVersion;
const listeners = new Set<() => void>();
const set = (next: SelfUpdate) => {
  state = next;
  for (const listener of listeners) listener();
};

/** The app came up on this code; without it, the next launch goes back to the APK's. */
export function confirmLaunch() {
  native?.confirm();
}

let started: string | undefined;

/** Fetches the desktop's newer code, if it has some this app can run. */
export async function checkForUpdate(
  offer: PhoneAppRelease | undefined,
  fetchChunk: (path: string, offset: number) => Promise<string>,
) {
  if (!native || !runtime || !offer || !newerVersion(offer.version, runningVersion)) return;
  if (offer.runtime !== runtime) {
    set({
      kind: "apk",
      version: offer.version,
      url: `https://github.com/${releasesRepo}/releases/download/v${offer.version}/Relay-Android.apk`,
    });
    return;
  }
  // Once a version per launch, and never again one that failed to start.
  if (started === offer.version || native.failed === offer.version) return;
  started = offer.version;
  const total = offer.files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  try {
    await native.begin();
    for (const file of offer.files) {
      // At least once, so an empty file exists too.
      let offset = 0;
      do {
        await native.append(file.path, await fetchChunk(file.path, offset));
        done += Math.min(phoneAppChunk, file.size - offset);
        offset += phoneAppChunk;
        set({ kind: "downloading", version: offer.version, done: total ? done / total : 1 });
      } while (offset < file.size);
    }
    await native.commit(
      offer.version,
      offer.files.map(({ path, sha256 }) => ({ path, sha256 })),
    );
    set({ kind: "ready", version: offer.version });
  } catch (e) {
    // A dropped link tries again on the next connection.
    console.warn(`Couldn't update to ${offer.version}:`, e);
    started = undefined;
    set({ kind: "none" });
  }
}

export function useSelfUpdate() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** What this app runs and where its update stands, for the desktop and Settings. */
export function appReport(update: SelfUpdate): PhoneAppReport {
  const apk = Constants.expoConfig?.version ?? "0.0.0";
  return {
    version: runningVersion,
    updated: runningUpdate,
    apk,
    updates: !!native && !!runtime,
    ...(update.kind !== "none"
      ? { update: { kind: update.kind, version: update.version } }
      : {}),
    ...(native?.failed ? { failed: native.failed } : {}),
  };
}

export const restartIntoUpdate = () => reloadAppAsync("Relay updated from the desktop");

/** Drops the desktop's code and restarts on the APK's own, in case an update misbehaves. */
export async function restartOnBuiltIn() {
  await native?.clear();
  await reloadAppAsync("Back to the app's own version");
}
