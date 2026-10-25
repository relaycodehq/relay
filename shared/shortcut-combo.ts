import type { KeyCombo } from "./shortcuts";

/** `mod` is ⌘ on macOS and Ctrl elsewhere; the key is the last part. */
export function combo(mac: boolean, spec: string): KeyCombo {
  const parts = spec.split("+");
  const code = parts.pop()!;
  const has = (name: string) => parts.includes(name);
  return {
    code,
    alt: has("alt"),
    ctrl: has("ctrl") || (!mac && has("mod")),
    meta: has("meta") || (mac && has("mod")),
    shift: has("shift"),
  };
}
export const one =
  (spec: string) =>
  (mac: boolean): KeyCombo[] => [combo(mac, spec)];
