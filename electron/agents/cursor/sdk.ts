import { compareVersions } from "../../../shared/agent-updates";
import {
  installedSdk,
  installSdk,
  latestSdkVersion,
  sdkLock,
  type Fetch,
  type InstalledSdk,
} from "./sdk-install";

/** Where Cursor's worker and SDK live on this machine; set once by the app. */
export interface CursorSetup {
  /** The bundled `cursor-worker.mjs`, somewhere Node can read it. */
  worker: string;
  /** Where downloaded SDKs go. */
  root: string;
  /** Where the SDK keeps its agents' history. */
  store: string;
  fetch: Fetch;
}

let setup: CursorSetup | undefined;
export function configureCursor(next: CursorSetup) {
  setup = next;
}
export function cursorSetup(): CursorSetup {
  if (!setup) throw new Error("Cursor isn't set up in this process.");
  return setup;
}

/** The SDK on disk, if Relay has downloaded one. */
export const currentSdk = () => installedSdk(cursorSetup().root);

/** The SDK on disk, downloaded first if there isn't one. */
export async function ensureSdk(): Promise<InstalledSdk> {
  const { root, fetch } = cursorSetup();
  return (await installedSdk(root)) ?? installSdk(root, fetch);
}

/** The newest release that has been out a few days, never older than the SDK Relay was made for. */
export async function newestSdk(): Promise<string> {
  const found = await latestSdkVersion(cursorSetup().fetch);
  return found && compareVersions(found, sdkLock.sdk) > 0 ? found : sdkLock.sdk;
}

/** Downloads `version` (the one Relay was made for by default) and makes it the SDK Relay runs. */
export function updateSdk(version?: string): Promise<InstalledSdk> {
  const { root, fetch } = cursorSetup();
  return installSdk(root, fetch, version ? { version } : {});
}
