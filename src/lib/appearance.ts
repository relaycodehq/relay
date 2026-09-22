import { useMemo, useSyncExternalStore } from "react";
import {
  applyToDocument,
  loadAppearance,
  resolveAppearance,
  saveAppearance,
  type Appearance,
  type ResolvedAppearance,
} from "./themes";
import { relayIconPng } from "./relay-icon";

let value: Appearance = loadAppearance();
let resolved: ResolvedAppearance;
const listeners = new Set<() => void>();
const media = matchMedia("(prefers-color-scheme: dark)");
let nativeTimer: ReturnType<typeof setTimeout> | undefined;

function apply() {
  resolved = resolveAppearance(value, media.matches);
  applyToDocument(resolved);
  for (const listener of listeners) listener();
  // Colour pickers fire continuously; only the settled colour reaches the
  // window background and dock icon.
  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(() => void syncNative(resolved), 250);
}

async function syncNative(current: ResolvedAppearance) {
  // A plain browser preview has no desktop bridge.
  if (!window.relay?.applyAppearance) return;
  try {
    await window.relay.applyAppearance({
      kind: current.palette.kind,
      background: current.palette.sidebar,
      icon: await relayIconPng(current.accent),
    });
  } catch {
    // Cosmetic; the in-window theme already applied.
  }
}

/** Applies the saved appearance before the first render. */
export function initAppearance() {
  apply();
  media.addEventListener("change", () => {
    if (value.mode === "system") apply();
  });
}

export function setAppearance(patch: Partial<Appearance>) {
  value = { ...value, ...patch };
  if ("accent" in patch && !patch.accent) delete value.accent;
  saveAppearance(value);
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance() {
  const current = useSyncExternalStore(subscribe, () => resolved);
  return { value, ...current };
}

/** Shiki themes for @pierre/diffs: the active theme fills its own mode. */
export function useSyntaxThemes() {
  const { palette } = useAppearance();
  return useMemo(
    () => ({
      light: palette.kind === "light" ? palette.syntax : "pierre-light",
      dark: palette.kind === "dark" ? palette.syntax : "pierre-dark",
    }),
    [palette.kind, palette.syntax],
  );
}
