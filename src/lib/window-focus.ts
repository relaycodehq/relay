import { useSyncExternalStore } from "react";

/**
 * Marks the root `data-inactive` while the window is unfocused, so looping
 * animations can hold still (see styles.css). Chromium already stops painting
 * a minimized or covered window, but a visible one behind the editor still
 * repaints every display refresh for as long as a spinner turns.
 */
export function initWindowFocus() {
  const root = document.documentElement;
  const sync = () =>
    root.toggleAttribute("data-inactive", !document.hasFocus());
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  sync();
}

function subscribe(change: () => void) {
  window.addEventListener("focus", change);
  window.addEventListener("blur", change);
  return () => {
    window.removeEventListener("focus", change);
    window.removeEventListener("blur", change);
  };
}

/** Whether Relay is the frontmost window. */
export function useWindowFocused() {
  return useSyncExternalStore(subscribe, () => document.hasFocus());
}
