import { useMemo, useSyncExternalStore } from "react";
// Imported themes register first so the saved choice can find them.
import "./imported-themes";
import "./readable-syntax";
import {
  applyToDocument,
  forgetStoredAppearance,
  hasStoredAppearance,
  loadAppearance,
  parseAppearance,
  resolveAppearance,
  resolveChoice,
  serializeAppearance,
  tokens,
  type Appearance,
  type AppearanceMode,
  type ResolvedAppearance,
  type ThemeChoice,
  type ThemeKind,
} from "./themes";
import { relayIconPng } from "./relay-icon";
import { setTitleBarBase } from "./titlebar-tint";
import { mac } from "./mod-key";
import { fileSetting } from "./settings-file";
import type { PhonePalette } from "../../shared/remote";

const store = fileSetting<Appearance>({
  path: ["appearance"],
  parse: parseAppearance,
  serialize: serializeAppearance,
  legacy: {
    read: () => (hasStoredAppearance() ? loadAppearance() : undefined),
    forget: forgetStoredAppearance,
  },
});
let value: Appearance = store.get();
store.subscribe(() => {
  value = store.get();
  apply();
});
let resolved: ResolvedAppearance;
const listeners = new Set<() => void>();
const media = matchMedia("(prefers-color-scheme: dark)");
let nativeTimer: ReturnType<typeof setTimeout> | undefined;

// Every token is an inherited custom property, so writing them on the root
// restyles the whole document, ~1.7 ms per thousand elements. Colour pickers
// only drag inside Settings, which hides the workspace while it's open, and
// hidden elements aren't restyled.
function apply() {
  resolved = resolveAppearance(value, media.matches);
  applyToDocument(resolved);
  document.documentElement.toggleAttribute("data-glass", glassOn());
  document.documentElement.toggleAttribute(
    "data-glass-chat",
    glassOn() && value.glassChat,
  );
  // How solid the sidebar and chat stay over the frost; the header a step more.
  const root = document.documentElement.style;
  root.setProperty("--glass-sidebar", `${100 - value.glassFrost}%`);
  root.setProperty(
    "--glass-header",
    `${Math.min(100, 123 - value.glassFrost)}%`,
  );
  root.setProperty("--glass-chat", `${100 - value.glassChatFrost}%`);
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
      glass: glassOn(),
      icon: await relayIconPng(current.accent),
    });
  } catch {
    // Cosmetic; the in-window theme already applied.
  }
}

function glassOn() {
  return mac && value.glass;
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
    send: t["--send"],
    onSend: t["--send-foreground"],
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
  store.set(next);
}

export function setGlass(glass: boolean) {
  update({ ...value, glass });
}

export function setGlassChat(glassChat: boolean) {
  update({ ...value, glassChat });
}

export function setGlassFrost(glassFrost: number) {
  update({ ...value, glassFrost });
}

export function setGlassChatFrost(glassChatFrost: number) {
  update({ ...value, glassChatFrost });
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
