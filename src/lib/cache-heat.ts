import { useSyncExternalStore } from "react";
import { localSwitch } from "./local-switch";

/**
 * Whether the context meter wears the prompt cache's fire and ice. Turning it
 * off lasts on this device; putting it out for one chat lasts until Relay
 * restarts.
 */
const heat = localSwitch("relay-cache-heat");
export const useCacheHeat = heat.use;
export const setCacheHeat = heat.set;

const listeners = new Set<() => void>();
let hiddenChats: ReadonlySet<string> = new Set();

/** Hides, or shows again, the decoration on one chat's meter. */
export function setCacheHeatHidden(chatId: string, hidden: boolean) {
  if (hiddenChats.has(chatId) === hidden) return;
  const next = new Set(hiddenChats);
  if (hidden) next.add(chatId);
  else next.delete(chatId);
  hiddenChats = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useCacheHeatHidden = (chatId: string | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => !!chatId && hiddenChats.has(chatId),
    () => false,
  );
