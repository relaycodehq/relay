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
  | "agent-tools"
  | "integrations"
  | "phone"
  | "computers"
  | "dictation"
  | "read-aloud"
  | "sounds"
  | "shortcuts"
  | "report"
  | "about";

const OPEN_SETTINGS = "relay:open-settings";

/**
 * Opens Settings at `category` from a feature the shell hands no way there;
 * `projectId` picks the project a "project" category shows, `entryId` the
 * setting it scrolls to.
 */
export function openSettings(
  category: SettingsCategory,
  projectId?: string,
  entryId?: string,
) {
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS, {
      detail: { category, projectId, entryId },
    }),
  );
}

/** The shell's side of `openSettings`; returns the unsubscribe. */
export function onOpenSettings(
  show: (
    category: SettingsCategory,
    projectId?: string,
    entryId?: string,
  ) => void,
) {
  const listener = (event: Event) => {
    const { category, projectId, entryId } = (
      event as CustomEvent<{
        category: SettingsCategory;
        projectId?: string;
        entryId?: string;
      }>
    ).detail;
    show(category, projectId, entryId);
  };
  window.addEventListener(OPEN_SETTINGS, listener);
  return () => window.removeEventListener(OPEN_SETTINGS, listener);
}
