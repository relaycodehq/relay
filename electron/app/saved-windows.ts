import {
  savedMainWindow,
  savedThreadWindows,
} from "../../shared/thread-windows";
import {
  editorWindowExists,
  savedEditorWindows,
} from "../../shared/editor-windows";
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

/** Opens the thread and editor windows the last run left open. */
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
  window.editors.restore({
    load: () => savedEditorWindows(store.get().editorWindows),
    save: (windows) =>
      void store
        .update((s) => {
          s.editorWindows = windows;
        })
        .catch((e) => console.warn("Could not save editor windows:", e)),
    exists: (editor) =>
      editorWindowExists(
        editor,
        store.get().projects ?? [],
        store.get().chats ?? [],
      ),
  });
}
