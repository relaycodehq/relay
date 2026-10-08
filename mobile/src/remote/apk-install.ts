// Installing a new APK from inside the app: one the desktop's version needs
// (self-update.ts handles everything else), or the newest one the release feed
// has (latest-app.ts). Android still asks the user to allow installs from
// Relay once, and to confirm each update.
import { useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";
import { requireOptionalNativeModule } from "expo";

/** modules/relay-apk; missing in Expo Go, on iOS, and in APKs from before it. */
interface RelayApk {
  canInstall(): boolean;
  /** Opens Android's "Install unknown apps" switch for Relay. */
  allowInstalls(): void;
  /** Resolves with the downloaded APK's path; a second call for the same version reuses it. */
  download(url: string, version: string, sha512?: string): Promise<string>;
  /** Shows Android's update prompt; on success Android closes the app. */
  install(path: string): Promise<"installed" | "cancelled">;
  addListener(event: "onProgress", listener: (e: { done: number }) => void): { remove(): void };
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

let fetching: { version: string; path: Promise<string | undefined> } | undefined;
let waitingForAllow: { remove(): void } | undefined;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function download(offer: ApkOffer, quiet: boolean): Promise<string | undefined> {
  if (!native) return Promise.resolve(undefined);
  if (fetching) {
    if (fetching.version !== offer.version) return Promise.resolve(undefined);
    // Asked for while it was coming down unasked: from now on it's the user's.
    if (!quiet && state.kind === "downloading") set({ ...state, quiet: false });
    return fetching.path;
  }
  const { version } = offer;
  const path = (async () => {
    set({ kind: "downloading", version, done: 0, quiet });
    const progress = native.addListener("onProgress", ({ done }) => {
      if (state.kind === "downloading") set({ ...state, done });
    });
    try {
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
      progress.remove();
      fetching = undefined;
    }
  })();
  fetching = { version, path };
  return path;
}

/** Downloads the APK without installing it, so a tap later goes straight to Android's prompt. */
export function prefetchApk(offer: ApkOffer) {
  if ("version" in state && (state.version === offer.version || state.kind === "installing" || state.kind === "allow"))
    return;
  void download(offer, true);
}

/** Downloads `offer` and asks Android to install it; without the native side, the browser does. */
export async function installApk(offer: ApkOffer) {
  if (!native) return void Linking.openURL(offer.url);
  if (state.kind === "installing") return;
  waitingForAllow?.remove();
  waitingForAllow = undefined;
  const path = await download(offer, false);
  if (!path) return;
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
  set({ kind: "installing", version });
  try {
    // "cancelled" leaves it downloaded for the next tap.
    await native.install(path);
    set({ kind: "downloaded", version });
  } catch (e) {
    set({ kind: "failed", version, message: message(e) });
  }
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
