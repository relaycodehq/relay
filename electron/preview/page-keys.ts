import type { WebContents } from "electron";

/**
 * A browser's own keys while the page has the keyboard, which Relay's window
 * never hears: ⌘R (Ctrl+R off macOS) reloads, ⌘T (Ctrl+T) asks for a new tab.
 */
export function browserKeys(
  wc: WebContents,
  { reload, newTab }: { reload: () => void; newTab: () => void },
  mac = process.platform === "darwin",
) {
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat) return;
    const mod = mac
      ? input.meta && !input.control
      : input.control && !input.meta;
    if (!mod || input.alt || input.shift) return;
    if (input.code === "KeyR") reload();
    else if (input.code === "KeyT") newTab();
    else return;
    event.preventDefault();
  });
}
