/**
 * Marks the root `data-pointer` from a click until the next Tab, so focus
 * rings only show once someone is actually tabbing (see styles.css).
 * Chromium's own `:focus-visible` also lights up a clicked button on any
 * later key press (Escape, Shift, arrows) or when a closing popup hands focus
 * back, which reads as a stray outline in a desktop app.
 */
export function initFocusRing() {
  const root = document.documentElement;
  window.addEventListener(
    "pointerdown",
    () => root.setAttribute("data-pointer", ""),
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => e.key === "Tab" && root.removeAttribute("data-pointer"),
    true,
  );
}
