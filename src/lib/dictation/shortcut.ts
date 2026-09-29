import {
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { mac } from "../mod-key";

/**
 * The dictation key. Tap it to start and tap again to finish, or hold it and
 * let go to finish. Matched by physical key, so it works on any layout.
 */
export interface DictationShortcut {
  code: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

const STORAGE_KEY = "relay-dictation-shortcut";
export const defaultDictationShortcut: DictationShortcut = {
  code: "Space",
  alt: mac,
  ctrl: !mac,
  meta: false,
  shift: false,
};
const listeners = new Set<() => void>();
let current = read();

function read(): DictationShortcut {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved.code === "string") return saved;
  } catch {
    // Falls back to the default.
  }
  return defaultDictationShortcut;
}

export function setDictationShortcut(next: DictationShortcut) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const dictationShortcut = () => current;
export const useDictationShortcut = () =>
  useSyncExternalStore(subscribe, () => current);

export const matchesShortcut = (
  e: KeyboardEvent | ReactKeyboardEvent,
  shortcut: DictationShortcut,
) =>
  e.code === shortcut.code &&
  e.altKey === shortcut.alt &&
  e.ctrlKey === shortcut.ctrl &&
  e.metaKey === shortcut.meta &&
  e.shiftKey === shortcut.shift;

const modifierCodes = /^(Alt|Control|Meta|Shift|OS)(Left|Right)?$/;

/** The shortcut a keypress would record, or null for a lone modifier or a bare key. */
export function shortcutFrom(e: KeyboardEvent | ReactKeyboardEvent) {
  if (modifierCodes.test(e.code)) return null;
  const shortcut = {
    code: e.code,
    alt: e.altKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
  };
  // A bare letter or Space would fire while typing; F-keys are fine alone.
  if (
    !shortcut.alt &&
    !shortcut.ctrl &&
    !shortcut.meta &&
    !/^F\d+$/.test(e.code)
  )
    return null;
  return shortcut;
}

function keyName(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const names: Record<string, string> = {
    Space: "Space",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };
  return names[code] ?? code;
}

export function shortcutLabel(shortcut: DictationShortcut) {
  const key = keyName(shortcut.code);
  if (mac)
    return (
      (shortcut.ctrl ? "⌃" : "") +
      (shortcut.alt ? "⌥" : "") +
      (shortcut.shift ? "⇧" : "") +
      (shortcut.meta ? "⌘" : "") +
      key
    );
  return [
    shortcut.ctrl && "Ctrl",
    shortcut.alt && "Alt",
    shortcut.shift && "Shift",
    shortcut.meta && "Super",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
