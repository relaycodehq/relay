import type { WebContents } from "electron";

/**
 * ⌘R (Ctrl+R off macOS) reloads the page while it has the keyboard, as in
 * a browser. Relay's window never hears keys pressed inside the page.
 */
export function reloadOnKey(
  wc: WebContents,
  reload: () => void,
  mac = process.platform === "darwin",
) {
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat) return;
    const mod = mac
      ? input.meta && !input.control
      : input.control && !input.meta;
    if (!mod || input.alt || input.shift || input.code !== "KeyR") return;
    event.preventDefault();
    reload();
  });
}
