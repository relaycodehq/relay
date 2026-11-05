import { mac } from "./mod-key";

/**
 * Whether a key event is typing into a field. Pierre's code editor types
 * inside a shadow root, where `e.target` is only its host.
 */
export function isTypingTarget(e: Event) {
  const target = e.composedPath()[0];
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * A press in a field that AltGr turns into a character, like € on a German
 * keyboard's AltGr+E. Windows reports AltGr as Ctrl+Alt, so it would
 * otherwise pass for a Ctrl+Alt shortcut and the character would be lost.
 */
export function typesWithAltGr(e: KeyboardEvent) {
  // On macOS, Option is a shortcut's modifier, whatever it types.
  if (mac) return false;
  if (!e.getModifierState("AltGraph")) return false;
  // Chromium also reports a left Ctrl+Alt as AltGraph on such a layout; a
  // key AltGr types nothing with keeps its plain letter, and stays a shortcut.
  const typesCharacter = e.key.length === 1 && !/^[a-z0-9]$/i.test(e.key);
  return typesCharacter && isTypingTarget(e);
}
