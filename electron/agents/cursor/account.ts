import type { CursorSdkIo } from "../agent-updates";
import { cursorCall } from "./connection";
import { forgetCursorModels } from "./catalog";
import { currentSdk, ensureSdk, newestSdk, updateSdk } from "./sdk";

/** How long a browser sign-in may take before Relay gives up on it. */
const signInTimeout = 5 * 60_000;

/** What Settings' agent rows ask of Cursor: the SDK Relay downloaded, and who is signed in. */
export const cursorSdkIo: CursorSdkIo = {
  installed: async () => (await currentSdk())?.version,
  newest: newestSdk,
  install: async (version) => {
    await updateSdk(version);
  },
  account: async () => {
    const sdk = await currentSdk();
    if (!sdk) return undefined;
    const auth = await cursorCall(sdk, "auth.status", {});
    return auth.status === "logged-in"
      ? { signedIn: true, email: auth.email }
      : { signedIn: false };
  },
};

/** Opens Cursor's sign-in in the browser; resolves once it's done. Downloads the SDK first if needed. */
export async function signInCursor() {
  const sdk = await ensureSdk();
  await cursorCall(sdk, "auth.login", {}, signInTimeout);
  forgetCursorModels();
}

export async function signOutCursor() {
  const sdk = await currentSdk();
  if (!sdk) return;
  await cursorCall(sdk, "auth.logout", {});
  forgetCursorModels();
}
