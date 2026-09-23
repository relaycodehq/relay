import { useSyncExternalStore } from "react";

/**
 * Whether the context meter wears the prompt cache's fire and ice. Turning it
 * off is a per-device preference like the usage ring, so it lives in
 * localStorage; putting it out for one chat lasts until Relay restarts.
 */
const STORAGE_KEY = "relay-cache-heat";
const listeners = new Set<() => void>();
let shown = read();
let hiddenChats: ReadonlySet<string> = new Set();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

export function setCacheHeat(next: boolean) {
  shown = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Still applies for this session.
  }
  notify();
}

/** Hides, or shows again, the decoration on one chat's meter. */
export function setCacheHeatHidden(chatId: string, hidden: boolean) {
  if (hiddenChats.has(chatId) === hidden) return;
  const next = new Set(hiddenChats);
  if (hidden) next.add(chatId);
  else next.delete(chatId);
  hiddenChats = next;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useCacheHeat = () =>
  useSyncExternalStore(
    subscribe,
    () => shown,
    () => true,
  );

export const useCacheHeatHidden = (chatId: string | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => !!chatId && hiddenChats.has(chatId),
    () => false,
  );
