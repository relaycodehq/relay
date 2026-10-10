import { useSyncExternalStore } from "react";
import type { ThreadWindowsState } from "../../../shared/thread-windows";
import { api } from "../../lib/api";

let state: ThreadWindowsState = { open: [], focused: null };
const listeners = new Set<() => void>();
function set(next: ThreadWindowsState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Keeps up with which threads have windows of their own; call once per page. */
export function followThreadWindows() {
  const stop = api.onThreadWindows(set);
  void api
    .threadWindows()
    .then(set)
    .catch(() => {});
  return stop;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useThreadWindows = () =>
  useSyncExternalStore(subscribe, () => state);

/** Whether `chatId` is in a window of its own. */
export const useHasOwnWindow = (chatId: string | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => !!chatId && state.open.some((w) => w.chatId === chatId),
  );

export const hasOwnWindow = (chatId: string) =>
  state.open.some((w) => w.chatId === chatId);

/** The thread whose own window is in front, if one is. */
export const focusedThreadWindow = () => state.focused;
