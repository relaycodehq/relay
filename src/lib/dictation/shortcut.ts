import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { mac } from "../mod-key";
import { persistedStore } from "../persisted-store";

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

export const defaultDictationShortcut: DictationShortcut = {
  code: "Space",
  alt: mac,
  ctrl: !mac,
  meta: false,
  shift: false,
};
const shortcut = persistedStore<DictationShortcut>(
  "relay-dictation-shortcut",
  (saved) => {
    const parsed = JSON.parse(saved ?? "null");
    return parsed && typeof parsed.code === "string"
      ? parsed
      : defaultDictationShortcut;
  },
  (value) => JSON.stringify(value),
);
export const setDictationShortcut = shortcut.set;
export const dictationShortcut = shortcut.get;
export const useDictationShortcut = shortcut.use;

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
