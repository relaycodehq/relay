import { isFunctionKey } from "./shortcut-accelerator";
import {
  command,
  isDigit,
  modifierCode,
  type KeyCombo,
  type ShortcutId,
} from "./shortcuts";

/** Keys that type something, so they can't be a shortcut alone in a field. */
const printable =
  /^(Key[A-Z]|Digit\d|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|IntlBackslash)$/;

export type Recorded =
  | { kind: "wait" }
  | { kind: "combo"; combo: KeyCombo }
  | { kind: "invalid"; reason: string };

/**
 * What a keypress in the shortcut recorder makes of `id`'s binding. Esc and
 * Backspace are the recorder's own keys and never get here.
 */
export function recordCombo(
  e: {
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  id: ShortcutId,
  mac: boolean,
): Recorded {
  if (!e.code || modifierCode.test(e.code)) return { kind: "wait" };
  const next: KeyCombo = {
    code: e.code,
    alt: e.altKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
  };
  const held = next.alt || next.ctrl || next.meta;
  const mods = mac ? "⌘, ⌃ or ⌥" : "Ctrl or Alt";
  const cmd = command(id);
  if (
    /^(Enter|NumpadEnter|Tab|Escape)$/.test(next.code) &&
    !(cmd.sends && held && /Enter$/.test(next.code))
  )
    return {
      kind: "invalid",
      reason: cmd.sends
        ? `Tab and Esc keep their usual jobs, and Enter needs ${mods}. Try another key.`
        : "Enter, Tab and Esc keep their usual jobs. Try another key.",
    };
  if (cmd.digits) {
    if (!isDigit(next.code) || !held)
      return {
        kind: "invalid",
        reason: `Hold ${mods} and press any digit from 1 to 9.`,
      };
    return { kind: "combo", combo: { ...next, code: "Digit1" } };
  }
  if (!held && !isFunctionKey(next.code)) {
    if (!cmd.bare)
      return {
        kind: "invalid",
        reason: `Add ${mods}. A plain key would type instead.`,
      };
    if (!printable.test(next.code))
      return {
        kind: "invalid",
        reason: `That key moves around the page. Try a letter, or add ${mods}.`,
      };
  }
  return { kind: "combo", combo: next };
}
