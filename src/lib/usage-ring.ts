import { useSyncExternalStore } from "react";

/**
 * Whether the usage ring shows in the composer next to the context meter. A
 * per-device preference like the theme, so it lives in localStorage rather
 * than settings.
 */
const STORAGE_KEY = "relay-usage-ring";
const listeners = new Set<() => void>();
let shown = read();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setUsageRing(next: boolean) {
  shown = next;
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

export const useUsageRing = () =>
  useSyncExternalStore(
    subscribe,
    () => shown,
    () => true,
  );
