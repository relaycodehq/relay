import type { KeyboardEvent } from "react";
import { mac } from "./mod-key";
import { persistedStore } from "./persisted-store";

/**
 * Which key sends a chat message: Enter (Shift+Enter for a new line),
 * Shift+Enter or ⌘/Ctrl+Enter (Enter for a new line). A per-device
 * preference like the theme, so it lives in localStorage rather than settings.
 */
export type SendKey = "enter" | "shift-enter" | "mod-enter";
const sendKey = persistedStore<SendKey>(
  "relay-send-key",
  (saved) =>
    saved === "mod-enter" || saved === "shift-enter" ? saved : "enter",
  (key) => key,
);
export const setSendKey = sendKey.set;
export const useSendKey = sendKey.use;

/** What the send key and button do while an answer is running. */
export type RunningSendAction = "queue" | "steer";
const runningSendAction = persistedStore<RunningSendAction>(
  "relay-running-send-action",
  (saved) => (saved === "steer" ? "steer" : "queue"),
  (action) => action,
);
export const setRunningSendAction = runningSendAction.set;
export const useRunningSendAction = runningSendAction.use;

/**
 * The send key follows the running-action preference; adding ⌘/Ctrl does
 * the other action. With ⌘/Ctrl+Enter as the send key, add Shift instead.
 * Without a running answer, either action just sends the message.
 */
export function sendAction(
  e: KeyboardEvent,
  sendKey: SendKey,
  runningAction: RunningSendAction,
): "send" | "steer" | null {
  if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229)
    return null;
  if (e.altKey) return null;
  const primary = runningAction === "steer" ? "steer" : "send";
  const alternate = runningAction === "steer" ? "send" : "steer";
  const mod = e.metaKey || e.ctrlKey;
  if (sendKey === "mod-enter")
    return mod ? (e.shiftKey ? alternate : primary) : null;
  if (mod) return alternate;
  return e.shiftKey === (sendKey === "shift-enter") ? primary : null;
}

/** Any send action; for composers without a running agent to steer. */
export function sendsMessage(e: KeyboardEvent, sendKey: SendKey) {
  return sendAction(e, sendKey, "queue") !== null;
}

const mod = mac ? "⌘" : "Ctrl+";
const shift = mac ? "⇧" : "Shift+";
const enter = mac ? "↵" : "Enter";

export function sendKeyLabel(sendKey: SendKey) {
  return sendKey === "enter"
    ? enter
    : (sendKey === "shift-enter" ? shift : mod) + enter;
}

function alternateKeyLabel(sendKey: SendKey) {
  return mod + (sendKey === "mod-enter" ? shift : "") + enter;
}

export function queueKeyLabel(sendKey: SendKey, action: RunningSendAction) {
  return action === "queue"
    ? sendKeyLabel(sendKey)
    : alternateKeyLabel(sendKey);
}

export function steerKeyLabel(sendKey: SendKey, action: RunningSendAction) {
  return action === "steer"
    ? sendKeyLabel(sendKey)
    : alternateKeyLabel(sendKey);
}
