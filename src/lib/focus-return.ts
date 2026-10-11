import { useLayoutEffect } from "react";

/**
 * Puts focus back on `el` once whatever held it is gone, so the next key
 * doesn't land on <body>. Leaves it where it is when something else (a new
 * thread's composer, say) took it in the meantime, or when `el` went away.
 */
export function restoreFocus(el: Element | null) {
  requestAnimationFrame(() => {
    if (!(el instanceof HTMLElement) || !el.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (!el.checkVisibility()) return;
    el.focus({ preventScroll: true });
  });
}

/** Hands focus back to what had it when this component mounted, as it unmounts. */
export function useReturnFocus() {
  useLayoutEffect(() => {
    const from = document.activeElement;
    return () => restoreFocus(from);
  }, []);
}
