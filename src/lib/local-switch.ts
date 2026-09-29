import { persistedStore } from "./persisted-store";

/**
 * An on/off preference kept per device in localStorage, like the theme, and
 * on until turned off. `use` reads it in a component; `set` changes it.
 */
export function localSwitch(key: string) {
  const { use, set } = persistedStore(
    key,
    (saved) => saved !== "off",
    (on) => (on ? "on" : "off"),
  );
  return { use, set };
}
