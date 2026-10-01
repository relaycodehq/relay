/**
 * Settings is a page over the workspace, not a dialog: the thread stays
 * mounted underneath, hidden. Keyboard handlers that keep quiet while a dialog
 * is open add this to their selector, so keys meant for Settings don't reach
 * the hidden thread (Escape twice would stop its agent).
 */
export const SETTINGS_PAGE = ".settings-screen";

/** The projects sidebar's resize range; Settings' own column shares it. */
export const SIDEBAR_WIDTH = { initial: 250, min: 210, max: 360 };
