import type { KeyboardEvent } from "react";
import { mac } from "./mod-key";
import { fileSetting, storedBefore } from "./settings-file";

/**
 * Which key sends a chat message: Enter (Shift+Enter for a new line),
 * Shift+Enter or ⌘/Ctrl+Enter (Enter for a new line). Kept in settings.json.
 */
export type SendKey = "enter" | "shift-enter" | "mod-enter";
const sendKeys: SendKey[] = ["enter", "shift-enter", "mod-enter"];
const sendKey = fileSetting<SendKey>({
  path: ["chat", "sendKey"],
  parse: (saved) =>
    sendKeys.includes(saved as SendKey) ? (saved as SendKey) : "enter",
  serialize: (key) => (key === "enter" ? undefined : key),
  legacy: storedBefore("relay-send-key", (raw) =>
    sendKeys.includes(raw as SendKey) ? (raw as SendKey) : undefined,
  ),
});
export const setSendKey = sendKey.set;
export const useSendKey = sendKey.use;

/** What the send key and button do while an answer is running. */
export type RunningSendAction = "queue" | "steer";
const runningSendAction = fileSetting<RunningSendAction>({
  path: ["chat", "sendWhileRunning"],
  parse: (saved) => (saved === "steer" ? "steer" : "queue"),
  serialize: (action) => (action === "queue" ? undefined : action),
  legacy: storedBefore("relay-running-send-action", (raw) =>
    raw === "steer" ? "steer" : undefined,
  ),
});
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
  if (e.altKey) return null;
  return action(e, sendKey, runningAction);
}

/** The send key with ⌥/Alt added, for the send beside Send. */
export function altSends(e: KeyboardEvent, sendKey: SendKey) {
  return e.altKey && action(e, sendKey, "queue") === "send";
}

function action(
  e: KeyboardEvent,
  sendKey: SendKey,
  runningAction: RunningSendAction,
): "send" | "steer" | null {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return null;
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
