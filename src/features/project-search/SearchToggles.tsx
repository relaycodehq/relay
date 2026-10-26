import { keys } from "../../lib/mod-key";
import { IconButton } from "../../ui/ui";
import type { SearchFlags } from "./search-options";

/** Match case, Words and Regex, as the three small switches beside a search field. */
export function SearchToggles({
  flags,
  toggle,
}: {
  flags: SearchFlags;
  toggle: Record<keyof SearchFlags, () => void>;
}) {
  const item = (
    flag: keyof SearchFlags,
    label: string,
    shortcut: string,
    glyph: string,
  ) => (
    <IconButton
      key={flag}
      label={`${label} (${shortcut})`}
      className="ps-toggle"
      active={flags[flag]}
      onClick={toggle[flag]}
    >
      {glyph}
    </IconButton>
  );
  return (
    <span className="ps-flags">
      {item("caseSensitive", "Match case", keys("⌥C", "Alt+C"), "Aa")}
      {item("wholeWord", "Words", keys("⌥W", "Alt+W"), "ab")}
      {item("regex", "Regex", keys("⌥R", "Alt+R"), ".*")}
    </span>
  );
}

const codes = {
  KeyC: "caseSensitive",
  KeyW: "wholeWord",
  KeyR: "regex",
} as const;

/** Runs the switch an Alt+C, Alt+W or Alt+R names; true when it was one. */
export function flagShortcut(
  e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string },
  toggle: Record<keyof SearchFlags, () => void>,
) {
  const flag = codes[e.code as keyof typeof codes];
  if (!e.altKey || e.ctrlKey || e.metaKey || !flag) return false;
  toggle[flag]();
  return true;
}
