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
import { setTitleBarBase } from "./titlebar-tint";
import type { PhonePalette } from "../../shared/remote";

let value: Appearance = loadAppearance();
let resolved: ResolvedAppearance;
const listeners = new Set<() => void>();
const media = matchMedia("(prefers-color-scheme: dark)");
let nativeTimer: ReturnType<typeof setTimeout> | undefined;
let commitTimer: ReturnType<typeof setTimeout> | undefined;
let liveScope: HTMLElement | null = null;

// Every token is an inherited custom property, so writing them on the root
// restyles the whole document: ~1.7 ms per thousand elements, per change. A
// colour picker fires far faster than a long thread can restyle. While one is
// dragged the tokens go to the open dialog alone, and the rest of the page
// follows once the drag pauses.
const LIVE_SETTLE_MS = 200;

/** Where dragged colours show at once: the dialog editing them. */
export function setLiveScope(element: HTMLElement | null) {
  if (element === liveScope) return;
  if (!element) commit();
  liveScope = element;
}

function commit() {
  clearTimeout(commitTimer);
  applyToDocument(resolved);
  if (liveScope)
    for (const name of Object.keys(tokens(resolved)))
      liveScope.style.removeProperty(name);
}

function apply(live = false) {
  resolved = resolveAppearance(value, media.matches);
  if (live && liveScope) {
    for (const [name, token] of Object.entries(tokens(resolved)))
      liveScope.style.setProperty(name, token);
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, LIVE_SETTLE_MS);
  } else commit();
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
  setTitleBarBase(current.palette.surface, current.palette.text);
  try {
    await window.relay.applyAppearance({
      mode: value.mode,
      background: current.palette.sidebar,
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

function update(next: Appearance, live = false) {
  value = next;
  saveAppearance(value);
  apply(live);
}

export function setMode(mode: AppearanceMode) {
  update({ ...value, mode });
}

/**
 * Patches one mode's theme; an undefined field goes back to the theme's.
 * `live` is for controls that fire continuously (see `setLiveScope`).
 */
export function setThemeChoice(
  kind: ThemeKind,
  patch: Partial<ThemeChoice>,
  live = false,
) {
  const choice = { ...value[kind], ...patch };
  for (const key of Object.keys(patch) as (keyof ThemeChoice)[])
    if (choice[key] === undefined) delete choice[key];
  update({ ...value, [kind]: choice }, live);
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
