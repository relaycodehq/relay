/** App shortcuts pair with ⌘ on macOS and with Ctrl on Linux and Windows. */
export const mac = navigator.platform.startsWith("Mac");
export const windows = navigator.platform.startsWith("Win");

/** A shortcut's label as this platform types it. */
export const keys = (onMac: string, elsewhere: string) =>
  mac ? onMac : elsewhere;

/** What this platform calls its file browser. */
export const fileManager = mac
  ? "Finder"
  : windows
    ? "Explorer"
    : "file manager";

export const revealLabel = `Show in ${fileManager}`;
