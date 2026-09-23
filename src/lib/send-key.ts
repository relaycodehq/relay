import { useSyncExternalStore, type KeyboardEvent } from "react";

/**
 * Which key sends a chat message: Enter (Shift+Enter for a new line),
 * Shift+Enter or ⌘/Ctrl+Enter (Enter for a new line). A per-device
 * preference like the theme, so it lives in localStorage rather than settings.
 */
export type SendKey = "enter" | "shift-enter" | "mod-enter";
const STORAGE_KEY = "relay-send-key";
const listeners = new Set<() => void>();
let current = read();

function read(): SendKey {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "mod-enter" || saved === "shift-enter" ? saved : "enter";
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

/**
 * What a keypress does in the composer. The send key sends, or queues while
 * an agent is working; adding ⌘/Ctrl steers the running answer instead.
 * ⌘/Ctrl+Enter is itself the send key in "mod-enter", so there ⌘/Ctrl+Shift+Enter steers.
 */
export function sendAction(
  e: KeyboardEvent,
  sendKey: SendKey,
): "send" | "steer" | null {
  if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229)
    return null;
  if (e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (sendKey === "mod-enter")
    return mod ? (e.shiftKey ? "steer" : "send") : null;
  if (mod) return "steer";
  return e.shiftKey === (sendKey === "shift-enter") ? "send" : null;
}

/** Any send action; for composers without a running agent to steer. */
export function sendsMessage(e: KeyboardEvent, sendKey: SendKey) {
  return sendAction(e, sendKey) !== null;
}

const mac =
  typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const mod = mac ? "⌘" : "Ctrl+";
const shift = mac ? "⇧" : "Shift+";
const enter = mac ? "↵" : "Enter";

export function sendKeyLabel(sendKey: SendKey) {
  return sendKey === "enter"
    ? enter
    : (sendKey === "shift-enter" ? shift : mod) + enter;
}

export function steerKeyLabel(sendKey: SendKey) {
  return mod + (sendKey === "mod-enter" ? shift : "") + enter;
}
