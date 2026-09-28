import { useMemo, useSyncExternalStore } from "react";
// Imported themes register first so the saved choice can find them.
import "./imported-themes";
import {
  applyToDocument,
  loadAppearance,
  resolveAppearance,
  resolveChoice,
  tokens,
  saveAppearance,
  type Appearance,
  type AppearanceMode,
  type ResolvedAppearance,
  type ThemeChoice,
  type ThemeKind,
} from "./themes";
import { relayIconPng } from "./relay-icon";
import type { PhonePalette } from "../../shared/remote";

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
  // Paired phones wear the same theme, in both modes.
  void window.relay
    .phoneAppearance?.({
      mode: value.mode,
      light: phonePalette(resolveChoice("light", value.light)),
      dark: phonePalette(resolveChoice("dark", value.dark)),
    })
    .catch(() => {});
  try {
    await window.relay.applyAppearance({
      mode: value.mode,
      background: current.palette.sidebar,
      titlebar: current.palette.surface,
      titlebarText: current.palette.text,
      icon: await relayIconPng(current.accent),
    });
  } catch {
    // Cosmetic; the in-window theme already applied.
  }
}

function phonePalette(resolved: ResolvedAppearance): PhonePalette {
  const t = tokens(resolved);
  return {
    kind: resolved.palette.kind,
    sidebar: t["--sidebar"],
    surface: t["--surface"],
    toolbar: t["--toolbar"],
    inbox: t["--inbox"],
    text: t["--text"],
    muted: t["--muted"],
    border: t["--border"],
    hover: t["--hover"],
    selected: t["--selected"],
    accent: t["--accent"],
    accentSoft: t["--accent-soft"],
    onAccent: t["--accent-foreground"],
    diffAddition: t["--diff-addition"],
    diffDeletion: t["--diff-deletion"],
  };
}

/** Applies the saved appearance before the first render. */
export function initAppearance() {
  apply();
  media.addEventListener("change", () => {
    if (value.mode === "system") apply();
  });
}

function update(next: Appearance) {
  value = next;
  saveAppearance(value);
  apply();
}

export function setMode(mode: AppearanceMode) {
  update({ ...value, mode });
}

/** Patches one mode's theme; an undefined field goes back to the theme's. */
export function setThemeChoice(kind: ThemeKind, patch: Partial<ThemeChoice>) {
  const choice = { ...value[kind], ...patch };
  for (const key of Object.keys(patch) as (keyof ThemeChoice)[])
    if (choice[key] === undefined) delete choice[key];
  update({ ...value, [kind]: choice });
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
