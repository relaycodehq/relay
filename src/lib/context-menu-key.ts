import { mac } from "./mod-key";

/**
 * Shift+F10 opens the focused element's right-click menu, as Chromium does by
 * itself on Windows and Linux. Mac keyboards have no menu key, so without it
 * every action that lives only in a right-click menu is mouse-only.
 */
export function initContextMenuKey() {
  if (!mac) return;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F10" || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)
      return;
    const target = document.activeElement;
    if (!(target instanceof HTMLElement) || target === document.body) return;
    e.preventDefault();
    const box = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: box.left + Math.min(16, box.width / 2),
        clientY: box.bottom,
      }),
    );
  });
}
