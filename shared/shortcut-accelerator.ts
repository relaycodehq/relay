import type { KeyCombo } from "./shortcuts";

/** F1 to F24. */
export const isFunctionKey = (code: string) =>
  /^F([1-9]|1[0-9]|2[0-4])$/.test(code);

const acceleratorKeys: Record<string, string> = {
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
  Backquote: "`",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Space: "Space",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
};

/**
 * Electron's accelerator for a combo, or undefined for a key it can't name.
 * Menus match the character a key types, so `typed` names it on the
 * keyboard's own layout when it knows.
 */
export function accelerator(
  c: KeyCombo,
  mac: boolean,
  typed?: (code: string) => string | undefined,
) {
  let key: string | undefined;
  let shift = c.shift;
  const own = typed?.(c.code);
  if (c.code === "Equal" && shift && (!own || own === "=")) {
    // Electron's own zoom-in: "Plus" is ⇧= on most layouts.
    key = "Plus";
    shift = false;
  } else if (own && /^[a-z0-9\-=[\];',./`\\]$/i.test(own))
    key = own.toUpperCase();
  else if (/^Key[A-Z]$/.test(c.code)) key = c.code.slice(3);
  else if (/^Digit\d$/.test(c.code)) key = c.code.slice(5);
  else if (/^Numpad\d$/.test(c.code)) key = "num" + c.code.slice(6);
  else if (isFunctionKey(c.code)) key = c.code;
  else key = acceleratorKeys[c.code];
  if (!key || c.twice) return undefined;
  return [
    c.ctrl && (mac ? "Control" : "Ctrl"),
    c.alt && "Alt",
    shift && "Shift",
    c.meta && (mac ? "Command" : "Super"),
    key,
  ]
    .filter(Boolean)
    .join("+");
}
