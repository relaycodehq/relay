// Installing a new APK from inside the app, for desktop versions whose native
// side this APK lacks (self-update.ts handles everything else). Android still
// asks the user to allow installs from Relay once, and to confirm each update.
import { useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";
import { requireOptionalNativeModule } from "expo";

/** modules/relay-apk; missing in Expo Go, on iOS, and in APKs from before it. */
interface RelayApk {
  canInstall(): boolean;
  /** Opens Android's "Install unknown apps" switch for Relay. */
  allowInstalls(): void;
  /** Resolves with the downloaded APK's path; a second call for the same version reuses it. */
  download(url: string, version: string): Promise<string>;
  /** Shows Android's update prompt; on success Android closes the app. */
  install(path: string): Promise<"installed" | "cancelled">;
  addListener(event: "onProgress", listener: (e: { done: number }) => void): { remove(): void };
}
const native = requireOptionalNativeModule<RelayApk>("RelayApk");

export type ApkInstall =
  | { kind: "idle" }
  | { kind: "downloading"; done: number }
  /** Waiting for the user to let Relay install apps. */
  | { kind: "allow" }
  /** Android's prompt is up; the app closes once the update is in. */
  | { kind: "installing" }
  | { kind: "failed"; message: string };

let state: ApkInstall = { kind: "idle" };
const listeners = new Set<() => void>();
const set = (next: ApkInstall) => {
  state = next;
  for (const listener of listeners) listener();
};

let busy = false;
let waitingForAllow: { remove(): void } | undefined;

/** Downloads Relay `version` and asks Android to install it; without the native side, the browser does. */
export async function installApk(version: string, url: string) {
  if (!native) return void Linking.openURL(url);
  if (busy) return;
  busy = true;
  waitingForAllow?.remove();
  waitingForAllow = undefined;
  let path: string;
  try {
    set({ kind: "downloading", done: 0 });
    const progress = native.addListener("onProgress", ({ done }) =>
      set({ kind: "downloading", done }),
    );
    try {
      path = await native.download(url, version);
    } finally {
      progress.remove();
    }
  } catch (e) {
    busy = false;
    return set({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
  }
  busy = false;
  if (native.canInstall()) return install(path);
  set({ kind: "allow" });
  // Carries on by itself once the user comes back with the switch on.
  waitingForAllow = AppState.addEventListener("change", (now) => {
    if (now !== "active" || !native.canInstall()) return;
    waitingForAllow?.remove();
    waitingForAllow = undefined;
    void install(path);
  });
  native.allowInstalls();
}

async function install(path: string) {
  if (!native || busy) return;
  busy = true;
  set({ kind: "installing" });
  try {
    await native.install(path);
    set({ kind: "idle" });
  } catch (e) {
    set({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
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
