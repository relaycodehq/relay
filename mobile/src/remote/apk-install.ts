// Installing a new APK from inside the app: one the desktop's version needs
// (self-update.ts handles everything else), or the newest one the release feed
// has (latest-app.ts). Android still asks the user to allow installs from
// Relay once, and to confirm each update.
import { useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { newerVersion } from "../../../shared/phone-app";
import { pendingVersion } from "./self-update";

/** modules/relay-apk; missing in Expo Go, on iOS, and in APKs from before it. */
interface RelayApk {
  canInstall(): boolean;
  /** Opens Android's "Install unknown apps" switch for Relay. */
  allowInstalls(): void;
  /** Resolves with the downloaded APK's path; a second call for the same version reuses it. */
  download(url: string, version: string, sha512?: string): Promise<string>;
  /** Shows Android's update prompt; on success Android closes the app. */
  install(path: string): Promise<"installed" | "cancelled">;
  addListener(
    event: "onProgress",
    listener: (e: { done: number }) => void,
  ): { remove(): void };
  /** APKs from before the phone read the feed itself lack these two. */
  checksums?: boolean;
  metered?(): boolean;
}
const native = requireOptionalNativeModule<RelayApk>("RelayApk");

/** The app can download and hand an APK to Android itself, not only through the browser. */
export const installsApks = !!native;

/** Whether the network costs by the byte; unknown on APKs from before. */
export const onMeteredNetwork = () => native?.metered?.();

export interface ApkOffer {
  version: string;
  url: string;
  sha512?: string;
}

export type ApkInstall =
  | { kind: "idle" }
  /** quiet: fetched ahead without being asked, so a failure stays quiet too. */
  | { kind: "downloading"; version: string; done: number; quiet: boolean }
  | { kind: "downloaded"; version: string }
  /** Waiting for the user to let Relay install apps. */
  | { kind: "allow"; version: string }
  /** Android's prompt is up; the app closes once the update is in. */
  | { kind: "installing"; version: string }
  | { kind: "failed"; version: string; message: string };

let state: ApkInstall = { kind: "idle" };
const listeners = new Set<() => void>();
const set = (next: ApkInstall) => {
  state = next;
  for (const listener of listeners) listener();
};

let fetching:
  { offer: ApkOffer; path: Promise<string | undefined> } | undefined;
let requested: Promise<void> | undefined;
let waitingForAllow: { remove(): void } | undefined;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function download(
  offer: ApkOffer,
  quiet: boolean,
): Promise<string | undefined> {
  if (!native) return Promise.resolve(undefined);
  if (fetching) {
    const active = fetching;
    // Asked for while it was coming down unasked: from now on it's the user's.
    if (!quiet && state.kind === "downloading") set({ ...state, quiet: false });
    const path = await active.path;
    if (
      active.offer.version === offer.version &&
      (!offer.sha512 || active.offer.sha512 === offer.sha512)
    )
      return path;
    // Re-enter native download to verify a same-version cache against the feed's checksum.
    return download(offer, quiet);
  }
  const { version } = offer;
  const path = Promise.resolve().then(async () => {
    set({ kind: "downloading", version, done: 0, quiet });
    let progress: { remove(): void } | undefined;
    try {
      progress = native.addListener("onProgress", ({ done }) => {
        if (state.kind === "downloading") set({ ...state, done });
      });
      const path = native.checksums
        ? await native.download(offer.url, version, offer.sha512 ?? "")
        : await native.download(offer.url, version);
      set({ kind: "downloaded", version });
      return path;
    } catch (e) {
      if (state.kind === "downloading" && state.quiet) {
        console.warn(`Couldn't download Relay ${version} ahead:`, e);
        set({ kind: "idle" });
      } else set({ kind: "failed", version, message: message(e) });
      return undefined;
    } finally {
      progress?.remove();
      fetching = undefined;
    }
  });
  fetching = { offer, path };
  return path;
}

/** Downloads the APK without installing it, so a tap later goes straight to Android's prompt. */
export function prefetchApk(offer: ApkOffer) {
  if (
    "version" in state &&
    (state.version === offer.version ||
      state.kind === "installing" ||
      state.kind === "allow")
  )
    return;
  void download(offer, true);
}

/** Downloads `offer` and asks Android to install it; without the native side, the browser does. */
export function installApk(offer: ApkOffer, { browser = false } = {}): Promise<void> {
  return (requested ??= requestInstall(offer, browser)
    .catch((e) => {
      waitingForAllow?.remove();
      waitingForAllow = undefined;
      set({ kind: "failed", version: offer.version, message: message(e) });
    })
    .finally(() => {
      requested = undefined;
    }));
}

async function requestInstall(offer: ApkOffer, browser: boolean) {
  if (browser || !native) {
    await Linking.openURL(offer.url);
    return;
  }
  if (state.kind === "installing") return;
  if (state.kind === "allow" && state.version === offer.version) {
    native.allowInstalls();
    return;
  }
  waitingForAllow?.remove();
  waitingForAllow = undefined;
  const path = await download(offer, false);
  if (!path) return;
  checkVersion(offer.version);
  if (native.canInstall()) return install(offer.version, path);
  set({ kind: "allow", version: offer.version });
  // Carries on by itself once the user comes back with the switch on.
  waitingForAllow = AppState.addEventListener("change", (now) => {
    if (now !== "active" || !native.canInstall()) return;
    waitingForAllow?.remove();
    waitingForAllow = undefined;
    void install(offer.version, path);
  });
  native.allowInstalls();
}

async function install(version: string, path: string) {
  if (!native || state.kind === "installing") return;
  try {
    checkVersion(version);
    set({ kind: "installing", version });
    // "cancelled" leaves it downloaded for the next tap.
    await native.install(path);
    set({ kind: "downloaded", version });
  } catch (e) {
    set({ kind: "failed", version, message: message(e) });
  }
}

function checkVersion(version: string) {
  const pending = pendingVersion();
  if (newerVersion(pending, version))
    throw new Error(`This app would replace Relay ${pending} with older code. Look for a new app again.`);
}

export function useApkInstall() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
