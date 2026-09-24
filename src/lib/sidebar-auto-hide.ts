import { useSyncExternalStore } from "react";

/**
 * Whether opening Changes, Files or History hides the projects sidebar to make
 * room, and brings it back once they close. A per-device preference like the
 * theme, so it lives in localStorage rather than settings.
 */
const STORAGE_KEY = "relay-sidebar-auto-hide";
const listeners = new Set<() => void>();
let enabled = read();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSidebarAutoHide(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useSidebarAutoHide = () =>
  useSyncExternalStore(
    subscribe,
    () => enabled,
    () => true,
  );
