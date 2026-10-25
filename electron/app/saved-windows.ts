import {
  savedMainWindow,
  savedThreadWindows,
} from "../../shared/thread-windows";
import type { AppWindow } from "./window";
import type { Store } from "./store";

/** Test runs park their windows off-screen and size them as each test needs. */
export function keepMainWindowPlace(window: AppWindow, store: Store) {
  if (process.env.RELAY_TEST_DATA) return;
  window.keepPlace({
    load: () => savedMainWindow(store.get().mainWindow),
    save: (place) =>
      void store
        .update((s) => {
          s.mainWindow = place;
        })
        .catch((e) => console.warn("Could not save the window's place:", e)),
  });
}

/** Opens the thread windows the last run left open. */
export function restorePoppedWindows(window: AppWindow, store: Store) {
  window.threads.restore({
    load: () => savedThreadWindows(store.get().threadWindows),
    save: (windows) =>
      void store
        .update((s) => {
          s.threadWindows = windows;
        })
        .catch((e) => console.warn("Could not save thread windows:", e)),
    exists: ({ chatId }) => !!store.get().chats?.some((c) => c.id === chatId),
  });
}
