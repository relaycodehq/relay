import { useSyncExternalStore } from "react";
import {
  RENDER_THEME_VARS,
  withSeries,
  type RenderTheme,
} from "../../../shared/html-render";

// The app's tokens as a page reads them, kept in step with the appearance
// settings, which rewrite the root's style and data-theme.
let snapshot: RenderTheme | undefined;
const listeners = new Set<() => void>();

function read(): RenderTheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const vars = Object.fromEntries(
    RENDER_THEME_VARS.map((name) => [
      name,
      style.getPropertyValue(name).trim(),
    ]),
  );
  return withSeries({
    scheme: root.dataset.theme === "dark" ? "dark" : "light",
    vars,
  });
}

const observer =
  typeof MutationObserver === "undefined"
    ? undefined
    : new MutationObserver(() => {
        const next = read();
        if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
        snapshot = next;
        for (const listener of listeners) listener();
      });

function subscribe(change: () => void) {
  if (!listeners.size)
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme"],
    });
  listeners.add(change);
  return () => {
    listeners.delete(change);
    if (listeners.size) return;
    observer?.disconnect();
    snapshot = undefined;
  };
}

export const useRenderTheme = () =>
  useSyncExternalStore(subscribe, () => (snapshot ??= read()));
