// The site's theme: Relay's own by default, or whichever the visitor picks in
// the Themes section. A pick spills across the page from where it was clicked,
// through the View Transitions API, and holds for the tab (sessionStorage),
// so the download page wears it too.
import { useEffect, useState } from "react";
import {
  applyToDocument,
  resolveChoice,
  themeById,
  themesFor,
  type ResolvedAppearance,
  type Theme,
  type ThemeKind,
} from "../../src/lib/themes";
import { reducedMotion } from "./motion";

export interface SiteTheme {
  theme: string;
  kind: ThemeKind;
  /** An accent from the theme's own swatches, when not its default. */
  accent?: string;
}

/** Every built-in theme once per colour mode it has, dark ones first. */
export const siteThemes: { theme: Theme; kind: ThemeKind; name: string }[] = (
  ["dark", "light"] as const
).flatMap((kind) =>
  themesFor(kind).map((theme) => ({
    theme,
    kind,
    name: theme.id === "relay" && kind === "light" ? "Relay Light" : theme.name,
  })),
);

export const relayDefault: SiteTheme = { theme: "relay", kind: "dark" };
const KEY = "relay-site:theme";
const EVENT = "relay-site-theme";

let current: SiteTheme = relayDefault;
let resolved: ResolvedAppearance = resolveChoice(relayDefault.kind, {
  theme: relayDefault.theme,
});

export const sameTheme = (a: SiteTheme, b: SiteTheme) =>
  a.theme === b.theme &&
  a.kind === b.kind &&
  (a.accent ?? null) === (b.accent ?? null);

function apply(next: SiteTheme) {
  current = next;
  resolved = resolveChoice(next.kind, {
    theme: next.theme,
    ...(next.accent ? { accent: next.accent } : {}),
  });
  applyToDocument(resolved);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved.palette.surface);
  window.dispatchEvent(new Event(EVENT));
}

/** Applies the tab's saved theme, or Relay's, before the page first draws. */
export function initSiteTheme() {
  let saved = relayDefault;
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(KEY) ?? "null",
    ) as SiteTheme | null;
    if (stored && themeById(stored.theme)[stored.kind]) saved = stored;
  } catch {
    // Unreadable storage: Relay's own theme.
  }
  apply(saved);
}

/**
 * Switches the site to `next`. With `from`, the page's pixel the change
 * should grow out from (the swatch that was clicked); the new look is clipped
 * to a circle around it that widens until it covers the window.
 */
export function setSiteTheme(next: SiteTheme, from?: { x: number; y: number }) {
  if (sameTheme(next, current)) return;
  sessionStorage.setItem(KEY, JSON.stringify(next));
  const root = document.documentElement;
  if (!from || reducedMotion() || !document.startViewTransition) {
    apply(next);
    return;
  }
  const radius = Math.hypot(
    Math.max(from.x, window.innerWidth - from.x),
    Math.max(from.y, window.innerHeight - from.y),
  );
  root.style.setProperty("--spill-x", `${from.x}px`);
  root.style.setProperty("--spill-y", `${from.y}px`);
  root.style.setProperty("--spill-r", `${Math.ceil(radius)}px`);
  root.dataset.spill = "";
  const transition = document.startViewTransition(() => apply(next));
  transition.finished.finally(() => delete root.dataset.spill);
}

/** The site's theme as it changes. */
export function useSiteTheme(): {
  choice: SiteTheme;
  resolved: ResolvedAppearance;
} {
  const [state, setState] = useState({ choice: current, resolved });
  useEffect(() => {
    const update = () => setState({ choice: current, resolved });
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return state;
}
