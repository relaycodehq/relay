/**
 * Settings is a page over the workspace, not a dialog: the thread stays
 * mounted underneath, hidden. Keyboard handlers that keep quiet while a dialog
 * is open add this to their selector, so keys meant for Settings don't reach
 * the hidden thread (Escape twice would stop its agent).
 */
export const SETTINGS_PAGE = ".settings-screen";

/** The projects sidebar's resize range; Settings' own column shares it. */
export const SIDEBAR_WIDTH = { initial: 250, min: 210, max: 360 };

export type SettingsCategory =
  | "appearance"
  | "project"
  | "agents"
  | "relay-models"
  | "quick-switch"
  | "integrations"
  | "plugins"
  | "phone"
  | "computers"
  | "dictation"
  | "read-aloud"
  | "sounds"
  | "shortcuts"
  | "about";

const OPEN_SETTINGS = "relay:open-settings";

/** Opens Settings at `category` from a feature the shell hands no way there. */
export function openSettings(category: SettingsCategory) {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS, { detail: category }));
}

/** The shell's side of `openSettings`; returns the unsubscribe. */
export function onOpenSettings(show: (category: SettingsCategory) => void) {
  const listener = (event: Event) =>
    show((event as CustomEvent<SettingsCategory>).detail);
  window.addEventListener(OPEN_SETTINGS, listener);
  return () => window.removeEventListener(OPEN_SETTINGS, listener);
}
