import { useSyncExternalStore, type KeyboardEvent } from "react";

/**
 * Which key sends a chat message: Enter (Shift+Enter for a new line) or
 * ⌘/Ctrl+Enter (Enter for a new line). A per-device preference like the
 * theme, so it lives in localStorage rather than settings.
 */
export type SendKey = "enter" | "mod-enter";
const STORAGE_KEY = "relay-send-key";
const listeners = new Set<() => void>();
let current = read();

function read(): SendKey {
  try {
    return localStorage.getItem(STORAGE_KEY) === "mod-enter"
      ? "mod-enter"
      : "enter";
  } catch {
    return "enter";
  }
}

export function setSendKey(next: SendKey) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useSendKey = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => "enter" as const,
  );

/** ⌘/Ctrl+Enter always sends; plain Enter sends when chosen in settings. */
export function sendsMessage(e: KeyboardEvent, sendKey: SendKey) {
  if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229)
    return false;
  if (e.metaKey || e.ctrlKey) return true;
  return sendKey === "enter" && !e.shiftKey && !e.altKey;
}
