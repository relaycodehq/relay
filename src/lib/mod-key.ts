/** App shortcuts pair with ⌘ on macOS and with Ctrl on Linux and Windows. */
export const mac = navigator.platform.startsWith("Mac");

/** A shortcut's label as this platform types it. */
export const keys = (onMac: string, elsewhere: string) =>
  mac ? onMac : elsewhere;

export const revealLabel = mac
  ? "Show in Finder"
  : navigator.platform.startsWith("Win")
    ? "Show in Explorer"
    : "Show in file manager";
