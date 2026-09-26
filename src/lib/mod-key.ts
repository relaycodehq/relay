/** App shortcuts pair with ⌘ on macOS and with Ctrl on Linux and Windows. */
export const mac = navigator.platform.startsWith("Mac");

/** `KeyboardEvent.key` of the platform's shortcut modifier. */
export const modKey = mac ? "Meta" : "Control";

/** The platform's shortcut modifier is held, whatever else is. */
export const modHeld = (e: { metaKey: boolean; ctrlKey: boolean }) =>
  mac ? e.metaKey : e.ctrlKey;

/** Of ⌘ and Ctrl, only the platform's shortcut modifier is held. */
export const modOnly = (e: { metaKey: boolean; ctrlKey: boolean }) =>
  mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;

/** A shortcut's label as this platform types it. */
export const keys = (onMac: string, elsewhere: string) =>
  mac ? onMac : elsewhere;
